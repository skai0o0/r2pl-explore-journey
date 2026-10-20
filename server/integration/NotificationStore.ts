import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import {
  ACTIVITY_NOTIFICATION_KINDS,
  type ActivityNotificationKind,
  type LiveNotification,
  type NotificationKind,
  type NotificationRouting,
  type PortalNotification,
} from "../../shared/integration/notifications.ts";
import { requireAdminPermission } from "./AdminAccessStore.ts";
import { PortalError } from "./PortalSignature.ts";

const cfg = GAME_CONFIG.notifications;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const object = (input: unknown, keys: readonly string[]) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw new PortalError(400, "INVALID_BODY");
  return input as Record<string, unknown>;
};
interface EventRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  school_slot: number | null;
  created_ms: string;
  expires_ms: string;
}
const projection = (r: EventRow): LiveNotification => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  schoolSlot: r.school_slot,
  createdAtMs: Number(r.created_ms),
  expiresAtMs: Number(r.expires_ms),
});
/** Insert in the gameplay transaction. Rolled-back/replayed commands cannot publish. */
export async function emitNotification(
  db: PoolClient,
  campaign: string,
  input: {
    key: string;
    kind: NotificationKind;
    title: string;
    body: string;
    schoolSlot?: number | null;
  },
): Promise<string | undefined> {
  // Foundation-only synthetic databases intentionally omit Portal integration tables.
  if (
    !(
      await db.query<{ ready: boolean }>(
        "SELECT to_regclass('r2pl_v2.notification_events') IS NOT NULL AS ready",
      )
    ).rows[0]?.ready
  )
    return;
  const title = input.title.trim(),
    body = input.body.trim(),
    school = input.schoolSlot ?? null;
  if (
    !title ||
    title.length > 100 ||
    !body ||
    body.length > 500 ||
    input.key.length > 200 ||
    !input.key
  )
    throw new PortalError(400, "INVALID_NOTIFICATION");
  const inserted = (
    await db.query<{ id: string }>(
      "INSERT INTO r2pl_v2.notification_events(campaign_id,event_key,kind,title,body,school_slot,live_expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+($7::bigint*interval '1 millisecond')) ON CONFLICT(campaign_id,event_key) DO NOTHING RETURNING id::text",
      [campaign, input.key, input.kind, title, body, school, cfg.liveTtlMs],
    )
  ).rows[0];
  if (!inserted) {
    const old = (
      await db.query<{
        id: string;
        kind: NotificationKind;
        title: string;
        body: string;
        school_slot: number | null;
      }>(
        "SELECT id::text,kind,title,body,school_slot FROM r2pl_v2.notification_events WHERE campaign_id=$1 AND event_key=$2",
        [campaign, input.key],
      )
    ).rows[0]!;
    if (
      old.kind !== input.kind ||
      old.title !== title ||
      old.body !== body ||
      old.school_slot !== school
    )
      throw new PortalError(409, "NOTIFICATION_KEY_CONFLICT");
    return old.id;
  }
  const forward =
    input.kind === "admin" ||
    (
      await db.query<{ enabled: boolean }>(
        "SELECT forward_to_portal AS enabled FROM r2pl_v2.notification_routes WHERE campaign_id=$1 AND kind=$2",
        [campaign, input.kind],
      )
    ).rows[0]?.enabled === true;
  if (forward)
    await db.query(
      "INSERT INTO r2pl_v2.notification_outbox(delivery_id,campaign_id,event_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'))",
      [randomUUID(), campaign, inserted.id, cfg.portalTtlMs],
    );
  return inserted.id;
}
export class NotificationStore {
  private pool: Pool;
  readonly campaign: string;
  constructor(pool: Pool, campaign: string) {
    this.pool = pool;
    this.campaign = campaign;
  }
  async locked<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.campaign}`,
      ]);
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async cursor(): Promise<string> {
    return this.locked(
      async (db) =>
        (
          await db.query<{ id: string }>(
            "SELECT COALESCE(max(id),0)::text AS id FROM r2pl_v2.notification_events WHERE campaign_id=$1",
            [this.campaign],
          )
        ).rows[0]!.id,
    );
  }
  async liveAfter(
    cursor: string,
  ): Promise<{ cursor: string; events: LiveNotification[] }> {
    return this.locked(async (db) => {
      const rows = (
        await db.query<EventRow>(
          "SELECT id::text,kind,title,body,school_slot,extract(epoch from created_at)*1000 AS created_ms,extract(epoch from live_expires_at)*1000 AS expires_ms FROM r2pl_v2.notification_events WHERE campaign_id=$1 AND id>$2 ORDER BY id LIMIT $3",
          [this.campaign, cursor, cfg.streamBatch],
        )
      ).rows;
      return {
        cursor: rows.at(-1)?.id ?? cursor,
        events: rows
          .filter(
            (r) => r.kind !== "admin" && Number(r.expires_ms) > Date.now(),
          )
          .map(projection),
      };
    });
  }
  async admin(actor: string, token: string, input?: unknown): Promise<unknown> {
    return this.locked(async (db) => {
      await requireAdminPermission(
        db,
        this.campaign,
        actor,
        token,
        "notifications.send",
      );
      if (input !== undefined) {
        const v = object(input, [
          "action",
          "routes",
          "key",
          "title",
          "body",
          "schoolId",
        ]);
        if (v.action === "routing") {
          if (
            !Array.isArray(v.routes) ||
            v.routes.length !== ACTIVITY_NOTIFICATION_KINDS.length
          )
            throw new PortalError(400, "INVALID_ROUTES");
          const seen = new Set<string>();
          for (const item of v.routes) {
            const r = object(item, ["kind", "forwardToPortal"]);
            if (
              !ACTIVITY_NOTIFICATION_KINDS.includes(
                r.kind as ActivityNotificationKind,
              ) ||
              typeof r.forwardToPortal !== "boolean" ||
              seen.has(String(r.kind))
            )
              throw new PortalError(400, "INVALID_ROUTES");
            seen.add(String(r.kind));
            await db.query(
              "INSERT INTO r2pl_v2.notification_routes(campaign_id,kind,forward_to_portal) VALUES($1,$2,$3) ON CONFLICT(campaign_id,kind) DO UPDATE SET forward_to_portal=EXCLUDED.forward_to_portal",
              [this.campaign, r.kind, r.forwardToPortal],
            );
          }
        } else if (v.action === "compose") {
          if (
            !uuid(v.key) ||
            typeof v.title !== "string" ||
            typeof v.body !== "string"
          )
            throw new PortalError(400, "INVALID_NOTIFICATION");
          const school =
            v.schoolId === null
              ? null
              : SCHOOLS.find((s) => s.id === v.schoolId)?.slot;
          if (school === undefined)
            throw new PortalError(400, "INVALID_SCHOOL");
          const id = await emitNotification(db, this.campaign, {
            key: `admin:${v.key}`,
            kind: "admin",
            title: v.title,
            body: v.body,
            schoolSlot: school,
          });
          if (!id) throw new PortalError(503, "NOTIFICATIONS_UNAVAILABLE");
          await db.query(
            "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'notification-compose',$3)",
            [
              this.campaign,
              actor,
              JSON.stringify({
                notificationId: id,
                title: v.title,
                schoolId: v.schoolId,
              }),
            ],
          );
          return { notificationId: id, queuedForPortal: true };
        } else throw new PortalError(400, "INVALID_ACTION");
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'notification-routing',$3)",
          [this.campaign, actor, JSON.stringify({ routes: v.routes })],
        );
      }
      const configured = (
        await db.query<{
          kind: ActivityNotificationKind;
          forward_to_portal: boolean;
        }>(
          "SELECT kind,forward_to_portal FROM r2pl_v2.notification_routes WHERE campaign_id=$1",
          [this.campaign],
        )
      ).rows;
      const routes: NotificationRouting[] = ACTIVITY_NOTIFICATION_KINDS.map(
        (kind) => ({
          kind,
          forwardToPortal:
            configured.find((r) => r.kind === kind)?.forward_to_portal ?? false,
        }),
      );
      const counts = (
        await db.query(
          "SELECT status,count(*)::int AS count FROM r2pl_v2.notification_outbox WHERE campaign_id=$1 GROUP BY status",
          [this.campaign],
        )
      ).rows;
      const recent = (
        await db.query(
          "SELECT o.delivery_id AS id,o.status,o.attempts,e.kind,e.title,o.available_at AS availableAt,o.delivered_at AS deliveredAt,o.expires_at AS expiresAt FROM r2pl_v2.notification_outbox o JOIN r2pl_v2.notification_events e ON e.id=o.event_id WHERE o.campaign_id=$1 ORDER BY e.id DESC LIMIT 30",
          [this.campaign],
        )
      ).rows;
      return { routes, counts, recent };
    });
  }
  async pull(input: unknown): Promise<unknown> {
    const v = object(input, ["limit"]);
    const limit = v.limit ?? 20;
    if (
      !Number.isSafeInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > cfg.portalBatch
    )
      throw new PortalError(400, "INVALID_LIMIT");
    return this.locked(async (db) => {
      await db.query(
        "UPDATE r2pl_v2.notification_outbox SET status='failed' WHERE campaign_id=$1 AND status IN ('pending','leased') AND (expires_at<=clock_timestamp() OR (attempts>=$2 AND (lease_until IS NULL OR lease_until<=clock_timestamp())))",
        [this.campaign, cfg.portalMaxAttempts],
      );
      const selected = (
        await db.query<{ delivery_id: string; event_id: string }>(
          "SELECT delivery_id,event_id::text FROM r2pl_v2.notification_outbox WHERE campaign_id=$1 AND status IN ('pending','leased') AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND attempts<$2 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY available_at,event_id LIMIT $3 FOR UPDATE SKIP LOCKED",
          [this.campaign, cfg.portalMaxAttempts, limit],
        )
      ).rows;
      const deliveries = [];
      for (const row of selected) {
        const lease = randomUUID();
        const state = (
          await db.query<{ until_ms: string; attempts: number }>(
            "UPDATE r2pl_v2.notification_outbox SET status='leased',lease_token=$2,lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond'),attempts=attempts+1 WHERE delivery_id=$1 RETURNING extract(epoch FROM lease_until)*1000 AS until_ms,attempts",
            [row.delivery_id, lease, cfg.portalLeaseMs],
          )
        ).rows[0]!;
        const e = (
          await db.query<EventRow>(
            "SELECT id::text,kind,title,body,school_slot,extract(epoch FROM created_at)*1000 AS created_ms,extract(epoch FROM live_expires_at)*1000 AS expires_ms FROM r2pl_v2.notification_events WHERE id=$1",
            [row.event_id],
          )
        ).rows[0]!;
        const payload: PortalNotification = {
          version: 1,
          notificationId: row.delivery_id,
          kind: e.kind,
          title: e.title,
          body: e.body,
          occurredAtMs: Number(e.created_ms),
          audience:
            e.school_slot === null
              ? { scope: "campaign" }
              : { scope: "school", schoolId: SCHOOLS[e.school_slot]!.id },
        };
        deliveries.push({
          deliveryId: row.delivery_id,
          leaseToken: lease,
          leaseUntilMs: Number(state.until_ms),
          attempt: state.attempts,
          notification: payload,
        });
      }
      return { version: 1, deliveries };
    });
  }
  async ack(input: unknown): Promise<unknown> {
    const v = object(input, ["deliveries"]);
    if (
      !Array.isArray(v.deliveries) ||
      v.deliveries.length < 1 ||
      v.deliveries.length > cfg.portalBatch
    )
      throw new PortalError(400, "INVALID_DELIVERIES");
    return this.locked(async (db) => {
      const seen = new Set<string>();
      for (const item of v.deliveries as unknown[]) {
        const d = object(item, ["deliveryId", "leaseToken", "delivered"]);
        if (
          !uuid(d.deliveryId) ||
          !uuid(d.leaseToken) ||
          typeof d.delivered !== "boolean" ||
          seen.has(d.deliveryId)
        )
          throw new PortalError(400, "INVALID_DELIVERIES");
        seen.add(d.deliveryId);
        const row = (
          await db.query<{
            status: string;
            lease_token: string;
            valid: boolean;
            attempts: number;
          }>(
            "SELECT status,lease_token,lease_until>clock_timestamp() AS valid,attempts FROM r2pl_v2.notification_outbox WHERE campaign_id=$1 AND delivery_id=$2 FOR UPDATE",
            [this.campaign, d.deliveryId],
          )
        ).rows[0];
        if (
          !row ||
          row.lease_token !== d.leaseToken ||
          (row.status !== "delivered" &&
            (row.status !== "leased" || !row.valid))
        )
          throw new PortalError(409, "NOTIFICATION_LEASE_CONFLICT");
        if (row.status === "delivered") continue;
        await db.query(
          "UPDATE r2pl_v2.notification_outbox SET status=$3,delivered_at=CASE WHEN $3='delivered' THEN clock_timestamp() ELSE NULL END,lease_until=NULL,available_at=clock_timestamp()+($4::bigint*interval '1 millisecond') WHERE campaign_id=$1 AND delivery_id=$2",
          [
            this.campaign,
            d.deliveryId,
            d.delivered
              ? "delivered"
              : row.attempts >= cfg.portalMaxAttempts
                ? "failed"
                : "pending",
            Math.min(3600000, 1000 * 2 ** row.attempts),
          ],
        );
      }
      return { acknowledged: seen.size };
    });
  }
}

import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { ROOT_ADMIN_EMAIL } from "../../shared/integration/adminAccess.ts";
import { authenticateAdminAccess } from "./AdminAccessStore.ts";
import { type CampaignBackup, createCampaignBackup } from "./CampaignBackup.ts";
import { resetCampaign } from "./CampaignReset.ts";
import { PortalError } from "./PortalSignature.ts";

const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const body = (v: unknown, keys: readonly string[]) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new PortalError(400, "INVALID_BODY");
  return v as Record<string, unknown>;
};
const points = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !/^\d{1,10}$/.test(v) ||
    BigInt(v) > BigInt(GAME_CONFIG.campaignAdmin.maxPoints)
  )
    throw new PortalError(400, "INVALID_POINTS");
  return BigInt(v);
};
export class RootCampaignStore {
  private resetting = false;
  private readonly pool: Pool;
  private readonly campaign: string;
  private readonly backup: CampaignBackup;
  private readonly lifecycle: {
    prepare: () => Promise<void>;
    finish: (changed: boolean) => void;
  };
  constructor(
    pool: Pool,
    campaign: string,
    backup: CampaignBackup = createCampaignBackup,
    lifecycle: {
      prepare: () => Promise<void>;
      finish: (changed: boolean) => void;
    } = { prepare: async () => {}, finish: () => {} },
  ) {
    this.pool = pool;
    this.campaign = campaign;
    this.backup = backup;
    this.lifecycle = lifecycle;
  }
  private async requireRoot(
    db: Pool | PoolClient,
    actor: string,
    token: string,
  ): Promise<void> {
    const root = await authenticateAdminAccess(db, this.campaign, token);
    if (
      !root ||
      root.actorId !== actor ||
      root.email !== ROOT_ADMIN_EMAIL ||
      root.protectedRoot !== true
    )
      throw new PortalError(403, "ROOT_ONLY");
  }
  private async locked<T>(
    actor: string,
    token: string,
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.campaign}`,
      ]);
      await this.requireRoot(db, actor, token);
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
  async handle(
    actor: string,
    token: string,
    input?: unknown,
  ): Promise<unknown> {
    await this.requireRoot(this.pool, actor, token);
    if (input === undefined)
      return this.locked(actor, token, async (db) => {
        const pools = (
          await db.query<{ school_slot: number; balance: string }>(
            "SELECT school_slot,balance::text FROM r2pl_v2.test_point_pools WHERE campaign_id=$1 ORDER BY school_slot",
            [this.campaign],
          )
        ).rows;
        return {
          pools: SCHOOLS.map((s) => ({
            schoolId: s.id,
            schoolName: s.shortName,
            balance:
              pools.find((p) => p.school_slot === s.slot)?.balance ?? null,
          })),
        };
      });
    const v = body(input, [
      "action",
      "key",
      "expectedBalance",
      "balance",
      "schoolId",
      "actorId",
      "query",
      "confirmation",
      "offset",
      "note",
      "reason",
      "kind",
      "from",
      "to",
    ]);
    if (v.action === "search")
      return (async () => {
        const db = this.pool;
        if (
          typeof v.query !== "string" ||
          v.query.trim().length < 2 ||
          v.query.length > 100
        )
          throw new PortalError(400, "INVALID_SEARCH");
        return {
          students: (
            await db.query(
              'SELECT m.actor_id AS "actorId",m.display_name AS name,m.external_student_id AS "externalId",m.school_id AS "schoolId",w.balance::text AS balance,o.email FROM r2pl_v2.portal_members m JOIN r2pl_v2.wallet_accounts w ON w.campaign_id=m.campaign_id AND w.actor_id=m.actor_id AND w.resource=\'fixture-credit\' LEFT JOIN r2pl_v2.portal_student_overrides o ON o.campaign_id=m.campaign_id AND o.external_student_id=m.external_student_id AND o.active WHERE m.campaign_id=$1 AND NOT EXISTS(SELECT 1 FROM r2pl_v2.partner_test_profiles p WHERE p.campaign_id=m.campaign_id AND p.actor_id=m.actor_id) AND (m.display_name ILIKE $2 OR m.external_student_id ILIKE $2 OR o.email ILIKE $2 OR m.actor_id::text ILIKE $2) ORDER BY m.display_name,m.actor_id LIMIT $3',
              [
                this.campaign,
                `%${v.query.trim()}%`,
                GAME_CONFIG.campaignAdmin.searchLimit,
              ],
            )
          ).rows,
        };
      })();
    if (v.action === "history") {
      if (typeof v.actorId !== "string" || !idPattern.test(v.actorId))
        throw new PortalError(400, "INVALID_ACTOR");
      if (
        !Number.isInteger(v.offset) ||
        Number(v.offset) < 0 ||
        Number(v.offset) > GAME_CONFIG.campaignAdmin.historyMaxOffset
      )
        throw new PortalError(400, "INVALID_OFFSET");
      const exists = await this.pool.query(
        "SELECT 1 FROM r2pl_v2.portal_members m WHERE campaign_id=$1 AND actor_id=$2 AND NOT EXISTS(SELECT 1 FROM r2pl_v2.partner_test_profiles p WHERE p.campaign_id=m.campaign_id AND p.actor_id=m.actor_id)",
        [this.campaign, v.actorId],
      );
      if (!exists.rowCount) throw new PortalError(404, "STUDENT_NOT_FOUND");
      const kind = v.kind ?? "all";
      if (
        typeof kind !== "string" ||
        !["all", "running", "points", "event", "map", "note"].includes(kind)
      )
        throw new PortalError(400, "INVALID_FILTER");
      const date = (value: unknown) => {
        if (value === undefined || value === "") return null;
        if (
          typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value
        )
          throw new PortalError(400, "INVALID_FILTER");
        return `${value}T00:00:00+07:00`;
      };
      const from = date(v.from),
        to = date(v.to);
      if (from && to && from > to) throw new PortalError(400, "INVALID_FILTER");
      const rows = await this.pool.query(
        `SELECT kind,detail,occurred_at AS "occurredAt" FROM (
          SELECT 'running' AS kind,receipt AS detail,created_at AS occurred_at,'r:'||revision::text AS sort_id FROM r2pl_v2.portal_running_receipts WHERE campaign_id=$1 AND actor_id=$2
          UNION ALL SELECT 'points',jsonb_build_object('resource',l.resource,'amount',l.amount::text,'result',c.result),l.created_at,'l:'||l.id::text FROM r2pl_v2.ledger_entries l JOIN r2pl_v2.command_results c ON c.campaign_id=l.campaign_id AND c.actor_id=l.actor_id AND c.command_key=l.command_key WHERE l.campaign_id=$1 AND l.actor_id=$2
          UNION ALL SELECT 'event',jsonb_build_object('title',title,'body',body),created_at,'e:'||id::text FROM r2pl_v2.game_events WHERE campaign_id=$1 AND actor_id=$2
          UNION ALL SELECT kind,detail,occurred_at,'a:'||id::text FROM r2pl_v2.student_history_archive WHERE campaign_id=$1 AND actor_id=$2
          UNION ALL SELECT 'map',jsonb_build_object('tiles',count(*),'commandKey',encode(command_key,'hex')),min(created_at),'m:'||encode(command_key,'hex') FROM r2pl_v2.world_mutations WHERE campaign_id=$1 AND command_actor=$2 GROUP BY command_key
        ) history WHERE ($5='all' OR kind=$5 OR ($5='running' AND kind='running-snapshot')) AND ($6::timestamptz IS NULL OR occurred_at >= $6::timestamptz) AND ($7::timestamptz IS NULL OR occurred_at < $7::timestamptz + interval '1 day') ORDER BY occurred_at DESC,sort_id DESC LIMIT $3 OFFSET $4`,
        [
          this.campaign,
          v.actorId,
          GAME_CONFIG.campaignAdmin.historyPageSize + 1,
          v.offset,
          kind,
          from,
          to,
        ],
      );
      return {
        entries: rows.rows.slice(0, GAME_CONFIG.campaignAdmin.historyPageSize),
        hasMore:
          rows.rows.length > GAME_CONFIG.campaignAdmin.historyPageSize &&
          Number(v.offset) + GAME_CONFIG.campaignAdmin.historyPageSize <=
            GAME_CONFIG.campaignAdmin.historyMaxOffset,
      };
    }
    if (!idPattern.test(String(v.key ?? "")))
      throw new PortalError(400, "INVALID_KEY");
    const key = Buffer.from(String(v.key).replaceAll("-", ""), "hex"),
      hash = createHash("sha256").update(JSON.stringify(v)).digest();
    const execute = async (db: PoolClient) => {
      const previous = (
        await db.query<{ payload_hash: Buffer; result: unknown }>(
          "SELECT payload_hash,result FROM r2pl_v2.command_results WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
          [this.campaign, actor, key],
        )
      ).rows[0];
      if (previous) {
        if (!previous.payload_hash.equals(hash))
          throw new PortalError(409, "COMMAND_KEY_CONFLICT");
        return { replayed: true, ...(previous.result as object) };
      }
      let result: Record<string, unknown>;
      if (v.action === "reset") {
        if (v.confirmation !== "RESET")
          throw new PortalError(400, "RESET_CONFIRMATION_REQUIRED");
        const backupPath = await this.backup(db);
        const summary = await resetCampaign(db, this.campaign);
        result = { action: "reset", backupCreated: true, summary };
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'campaign-reset',$3)",
          [
            this.campaign,
            actor,
            JSON.stringify({
              backupPath,
              summary,
              scope: "map-points-progress",
            }),
          ],
        );
      } else if (v.action === "note") {
        if (
          typeof v.actorId !== "string" ||
          !idPattern.test(v.actorId) ||
          typeof v.note !== "string" ||
          v.note.trim().length < 3 ||
          v.note.length > 1000
        )
          throw new PortalError(400, "INVALID_NOTE");
        const student = await db.query(
          "SELECT 1 FROM r2pl_v2.portal_members m WHERE campaign_id=$1 AND actor_id=$2 AND NOT EXISTS(SELECT 1 FROM r2pl_v2.partner_test_profiles p WHERE p.campaign_id=m.campaign_id AND p.actor_id=m.actor_id)",
          [this.campaign, v.actorId],
        );
        if (!student.rowCount) throw new PortalError(404, "STUDENT_NOT_FOUND");
        await db.query(
          "INSERT INTO r2pl_v2.student_history_archive(campaign_id,actor_id,kind,detail,occurred_at) VALUES($1,$2,'note',$3,clock_timestamp())",
          [
            this.campaign,
            v.actorId,
            JSON.stringify({ note: v.note.trim(), author: ROOT_ADMIN_EMAIL }),
          ],
        );
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'student-history-note',$3)",
          [
            this.campaign,
            actor,
            JSON.stringify({ target: v.actorId, note: v.note.trim() }),
          ],
        );
        result = { action: "note" };
      } else if (v.action === "set_pool" || v.action === "set_student") {
        if (
          v.action === "set_student" &&
          (typeof v.reason !== "string" ||
            v.reason.trim().length < 3 ||
            v.reason.length > 500)
        )
          throw new PortalError(400, "REASON_REQUIRED");
        const desired = points(v.balance),
          expected = points(v.expectedBalance);
        let walletActor: string,
          table: "r2pl_v2.test_point_pools" | "r2pl_v2.wallet_accounts",
          label: string;
        if (v.action === "set_pool") {
          const school = SCHOOLS.find((s) => s.id === v.schoolId);
          if (!school) throw new PortalError(400, "INVALID_SCHOOL");
          const row = (
            await db.query<{ actor_id: string; balance: string }>(
              "SELECT actor_id,balance::text FROM r2pl_v2.test_point_pools WHERE campaign_id=$1 AND school_slot=$2 FOR UPDATE",
              [this.campaign, school.slot],
            )
          ).rows[0];
          if (!row) throw new PortalError(404, "POOL_NOT_FOUND");
          walletActor = row.actor_id;
          table = "r2pl_v2.test_point_pools";
          label = school.id;
          if (BigInt(row.balance) !== expected)
            throw new PortalError(409, "BALANCE_CHANGED");
        } else {
          if (typeof v.actorId !== "string" || !idPattern.test(v.actorId))
            throw new PortalError(400, "INVALID_ACTOR");
          const row = (
            await db.query<{ actor_id: string; balance: string }>(
              "SELECT m.actor_id,w.balance::text FROM r2pl_v2.portal_members m JOIN r2pl_v2.wallet_accounts w ON w.campaign_id=m.campaign_id AND w.actor_id=m.actor_id AND w.resource='fixture-credit' WHERE m.campaign_id=$1 AND m.actor_id=$2 AND NOT EXISTS(SELECT 1 FROM r2pl_v2.partner_test_profiles p WHERE p.campaign_id=m.campaign_id AND p.actor_id=m.actor_id) FOR UPDATE OF w",
              [this.campaign, v.actorId],
            )
          ).rows[0];
          if (!row) throw new PortalError(404, "STUDENT_NOT_FOUND");
          walletActor = row.actor_id;
          table = "r2pl_v2.wallet_accounts";
          label = walletActor;
          if (BigInt(row.balance) !== expected)
            throw new PortalError(409, "BALANCE_CHANGED");
        }
        const delta = desired - expected;
        const ledgerKey = randomBytes(16),
          ledgerHash = createHash("sha256")
            .update(`admin-points:${String(v.key)}:${label}`)
            .digest();
        if (delta !== 0n) {
          await db.query(
            "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
            [
              this.campaign,
              walletActor,
              ledgerKey,
              ledgerHash,
              JSON.stringify({
                action: "admin-points",
                balance: desired.toString(),
                ...(v.action === "set_student"
                  ? {
                      reason: String(v.reason).trim(),
                      author: ROOT_ADMIN_EMAIL,
                    }
                  : {}),
              }),
            ],
          );
          if (v.action === "set_pool")
            await db.query(
              "INSERT INTO r2pl_v2.test_point_ledger(campaign_id,actor_id,command_key,resource,amount,pool_actor_id) VALUES($1,$2,$3,'fixture-credit',$4,$2)",
              [this.campaign, walletActor, ledgerKey, delta.toString()],
            );
          else
            await db.query(
              "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'fixture-credit',$4)",
              [this.campaign, walletActor, ledgerKey, delta.toString()],
            );
          await db.query(
            `UPDATE ${table} SET balance=$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'`,
            [this.campaign, walletActor, desired.toString()],
          );
        }
        result = { action: v.action, balance: desired.toString() };
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'campaign-points-adjustment',$3)",
          [
            this.campaign,
            actor,
            JSON.stringify({
              target: label,
              before: expected.toString(),
              after: desired.toString(),
              kind: v.action,
              ...(v.action === "set_student"
                ? { reason: String(v.reason).trim() }
                : {}),
            }),
          ],
        );
      } else throw new PortalError(400, "INVALID_ACTION");
      await db.query(
        "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
        [this.campaign, actor, key, hash, JSON.stringify(result)],
      );
      return result;
    };
    if (v.action !== "reset") return this.locked(actor, token, execute);
    if (this.resetting) throw new PortalError(409, "RESET_IN_PROGRESS");
    this.resetting = true;
    let changed = false,
      prepared = false;
    try {
      prepared = true;
      await this.lifecycle.prepare();
      const result = await this.locked(actor, token, execute);
      changed = !("replayed" in result);
      return result;
    } finally {
      try {
        if (prepared) this.lifecycle.finish(changed);
      } finally {
        this.resetting = false;
      }
    }
  }
}

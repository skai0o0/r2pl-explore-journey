import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { ROOT_ADMIN_EMAIL } from "../../shared/integration/adminAccess.ts";
import {
  type AdminPrincipal,
  isAmtechIdentity,
} from "../../shared/integration/identity.ts";
import {
  assertIdentifier,
  parseRunningSnapshot,
  snapshotWire,
} from "../../shared/integration/running.ts";
import { authenticateAdminAccess } from "./AdminAccessStore.ts";
import { NotificationStore } from "./NotificationStore.ts";
import { bindTestProfile } from "./PartnerTestProfiles.ts";
import type { PortalConfig } from "./PortalConfig.ts";
import { PortalError } from "./PortalSignature.ts";
import type { SchoolPlayActor } from "./SchoolPlayFixture.ts";

const digest = (text: string) => createHash("sha256").update(text).digest();
export function portalObject(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new PortalError(400, "INVALID_BODY");
  return input as Record<string, unknown>;
}
interface Member {
  actor_id: string;
  external_student_id: string;
  school_id: string;
  school_slot: number;
  display_name: string;
  active: boolean;
}
interface RunningState {
  revision: string;
  meters: number;
  weeklyMeters: number;
  week: number;
  attributedPoints: number;
  observedAtMs: number;
  pointsPerKm: number;
}
export class PortalStore {
  readonly pool: Pool;
  readonly config: PortalConfig;
  constructor(pool: Pool, config: PortalConfig) {
    this.pool = pool;
    this.config = config;
  }
  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.config.campaignId}`,
      ]);
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async acceptRequest(keyId: string, nonce: string): Promise<void> {
    await this.transaction(async (db) => {
      await db.query(
        "DELETE FROM r2pl_v2.portal_nonces WHERE campaign_id=$1 AND expires_at<clock_timestamp()",
        [this.config.campaignId],
      );
      await db.query(
        "DELETE FROM r2pl_v2.portal_rate_windows WHERE campaign_id=$1 AND window_id < floor(extract(epoch FROM clock_timestamp())/60)::bigint-1",
        [this.config.campaignId],
      );
      const inserted = await db.query(
        "INSERT INTO r2pl_v2.portal_nonces(campaign_id,key_id,nonce,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond')) ON CONFLICT DO NOTHING RETURNING 1",
        [
          this.config.campaignId,
          keyId,
          nonce,
          2 * GAME_CONFIG.integration.requestSkewMs,
        ],
      );
      if (!inserted.rowCount) throw new PortalError(409, "REQUEST_REPLAY");
      const quota = (
        await db.query<{ requests: number }>(
          "INSERT INTO r2pl_v2.portal_rate_windows(campaign_id,key_id,window_id,requests) VALUES($1,$2,floor(extract(epoch FROM clock_timestamp())/60)::bigint,1) ON CONFLICT(campaign_id,key_id,window_id) DO UPDATE SET requests=portal_rate_windows.requests+1 RETURNING requests",
          [this.config.campaignId, keyId],
        )
      ).rows[0]!;
      if (quota.requests > GAME_CONFIG.integration.requestsPerMinute)
        throw new PortalError(429, "RATE_LIMITED");
      // Credentials are never stored. Replay prevention is committed before business work.
    });
  }
  private async member(db: PoolClient, id: unknown): Promise<Member> {
    assertIdentifier(id);
    if (
      (
        await db.query(
          "SELECT 1 FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND external_student_id=$2",
          [this.config.campaignId, id],
        )
      ).rowCount
    )
      throw new PortalError(403, "ADMIN_CANNOT_PLAY");
    const row = (
      await db.query<Member>(
        "SELECT * FROM r2pl_v2.portal_members WHERE campaign_id=$1 AND external_student_id=$2 FOR UPDATE",
        [this.config.campaignId, id],
      )
    ).rows[0];
    if (!row) throw new PortalError(404, "MEMBER_NOT_FOUND");
    if (!row.active) throw new PortalError(403, "MEMBER_SUSPENDED");
    return row;
  }
  async upsertMember(input: unknown): Promise<unknown> {
    const value = portalObject(input, [
      "externalStudentId",
      "schoolId",
      "displayName",
      "eduVerified",
      "active",
      "email",
      "emailVerified",
    ]);
    assertIdentifier(value.externalStudentId);
    if (String(value.externalStudentId).startsWith("partner-test:"))
      throw new PortalError(403, "TEST_PROFILE_MANAGED_LOCALLY");
    if (isAmtechIdentity(value.email, value.emailVerified))
      return this.upsertAdmin(value);
    if (value.schoolId === "amtech")
      throw new PortalError(403, "VERIFIED_ADMIN_IDENTITY_REQUIRED");
    const school = SCHOOLS.find((school) => school.id === value.schoolId);
    if (
      !school ||
      value.eduVerified !== true ||
      typeof value.active !== "boolean" ||
      typeof value.displayName !== "string" ||
      !value.displayName.trim() ||
      value.displayName.length > 100 ||
      [...value.displayName].some((char) => char.charCodeAt(0) < 32)
    )
      throw new PortalError(400, "INVALID_VERIFIED_MEMBER");
    const displayName = value.displayName.trim();
    return this.transaction(async (db) => {
      if (
        (
          await db.query(
            "SELECT 1 FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND external_student_id=$2",
            [this.config.campaignId, value.externalStudentId],
          )
        ).rowCount
      )
        throw new PortalError(403, "ADMIN_CANNOT_PLAY");
      const old = (
        await db.query<Member>(
          "SELECT * FROM r2pl_v2.portal_members WHERE campaign_id=$1 AND external_student_id=$2 FOR UPDATE",
          [this.config.campaignId, value.externalStudentId],
        )
      ).rows[0];
      if (old && old.school_id !== school.id)
        throw new PortalError(409, "SCHOOL_CHANGE_REQUIRES_REVIEW");
      const actorId = old?.actor_id ?? randomUUID();
      await db.query(
        "INSERT INTO r2pl_v2.portal_members(campaign_id,external_student_id,actor_id,school_id,school_slot,display_name,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(campaign_id,external_student_id) DO UPDATE SET display_name=EXCLUDED.display_name,active=EXCLUDED.active",
        [
          this.config.campaignId,
          value.externalStudentId,
          actorId,
          school.id,
          school.slot,
          displayName,
          value.active,
        ],
      );
      await db.query(
        "INSERT INTO r2pl_prep.running_bindings(campaign_id,actor_id,provider,external_student_id,school_slot,external_school_id) VALUES($1,$2,'portal-v1',$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          this.config.campaignId,
          actorId,
          value.externalStudentId,
          school.slot,
          school.id,
        ],
      );
      for (const [resource, opening] of [
        ["fixture-credit", GAME_CONFIG.integration.initialPoints],
        ["fixture-crystals", GAME_CONFIG.integration.initialCrystals],
        ["fixture-treasure-map", 0],
        ...["aspire", "nitro", "predator"].map(
          (tier) =>
            [
              `key-${tier}`,
              GAME_CONFIG.integration.initialKeysPerTier,
            ] as const,
        ),
      ] as const)
        await db.query(
          "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING",
          [this.config.campaignId, actorId, resource, opening],
        );
      if (!value.active) {
        await db.query(
          "DELETE FROM r2pl_v2.portal_sessions WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, actorId],
        );
        await db.query(
          "DELETE FROM r2pl_v2.portal_launches WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, actorId],
        );
      }
      return {
        externalStudentId: value.externalStudentId,
        schoolId: school.id,
        active: value.active,
        role: "user",
        playable: true,
      };
    });
  }
  private async upsertAdmin(value: Record<string, unknown>): Promise<unknown> {
    if (
      typeof value.active !== "boolean" ||
      typeof value.displayName !== "string" ||
      !value.displayName.trim() ||
      value.displayName.length > 100 ||
      [...value.displayName].some((char) => char.charCodeAt(0) < 32)
    )
      throw new PortalError(400, "INVALID_VERIFIED_MEMBER");
    return this.transaction(async (db) => {
      const email = (value.email as string).trim().toLowerCase();
      // The recovery account can only authenticate locally, never via partner identity.
      if (email === ROOT_ADMIN_EMAIL)
        throw new PortalError(403, "ROOT_ADMIN_PROTECTED");
      const old = (
        await db.query<{
          actor_id: string;
          external_student_id: string;
          protected_root: boolean;
        }>(
          "SELECT actor_id,external_student_id,protected_root FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND (external_student_id=$2 OR email=$3) FOR UPDATE",
          [this.config.campaignId, value.externalStudentId, email],
        )
      ).rows;
      if (old.some((a) => a.protected_root))
        throw new PortalError(403, "ROOT_ADMIN_PROTECTED");
      if (
        old.some(
          (a) =>
            a.external_student_id !== value.externalStudentId &&
            !a.external_student_id.startsWith("local-admin:"),
        )
      )
        throw new PortalError(409, "IDENTITY_ALREADY_BOUND");
      if (old.length > 1) throw new PortalError(409, "IDENTITY_ALREADY_BOUND");
      if (old[0]?.external_student_id.startsWith("local-admin:"))
        await db.query(
          "UPDATE r2pl_v2.portal_admins SET external_student_id=$3 WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, old[0].actor_id, value.externalStudentId],
        );
      const player = (
        await db.query<Member>(
          "SELECT * FROM r2pl_v2.portal_members WHERE campaign_id=$1 AND external_student_id=$2 FOR UPDATE",
          [this.config.campaignId, value.externalStudentId],
        )
      ).rows[0];
      const actorId = old[0]?.actor_id ?? player?.actor_id ?? randomUUID();
      if (player) {
        // Preserve historical wallets; revoke all play authority when staff is identified.
        await db.query(
          "UPDATE r2pl_v2.portal_members SET active=false WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, player.actor_id],
        );
        await db.query(
          "DELETE FROM r2pl_v2.portal_sessions WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, player.actor_id],
        );
        await db.query(
          "DELETE FROM r2pl_v2.portal_launches WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, player.actor_id],
        );
        await db.query(
          "DELETE FROM r2pl_prep.running_bindings WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, player.actor_id],
        );
      }
      await db.query(
        "INSERT INTO r2pl_v2.portal_admins(campaign_id,external_student_id,actor_id,organization_id,email,display_name,active) VALUES($1,$2,$3,'amtech',$4,$5,$6) ON CONFLICT(campaign_id,external_student_id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,active=EXCLUDED.active",
        [
          this.config.campaignId,
          value.externalStudentId,
          actorId,
          email,
          (value.displayName as string).trim(),
          value.active,
        ],
      );
      if (!value.active) {
        await db.query(
          "DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, actorId],
        );
        await db.query(
          "DELETE FROM r2pl_v2.portal_admin_launches WHERE campaign_id=$1 AND actor_id=$2",
          [this.config.campaignId, actorId],
        );
      }
      return {
        externalStudentId: value.externalStudentId,
        organizationId: "amtech",
        schoolId: null,
        role: "admin",
        // Partner v1 staff identity stays non-competitive. Internal test play is
        // resolved from Game access grants during session exchange/bootstrap.
        playable: false,
        active: value.active,
      };
    });
  }
  notifications(): NotificationStore {
    return new NotificationStore(this.pool, this.config.campaignId);
  }
  async authenticateAdmin(token: unknown): Promise<AdminPrincipal | undefined> {
    return authenticateAdminAccess(this.pool, this.config.campaignId, token);
  }
  async running(input: unknown): Promise<unknown> {
    const value = portalObject(input, [
      "externalStudentId",
      "revision",
      "cumulativeMeters",
      "weeklyMeters",
      "observedAtMs",
      "weekStartMs",
    ]);
    const snapshot = parseRunningSnapshot({ ...value, provider: "portal-v1" });
    if (snapshot.cumulativeMeters > BigInt(Number.MAX_SAFE_INTEGER))
      throw new PortalError(400, "INVALID_SNAPSHOT_TIME_OR_DISTANCE");
    const wire = snapshotWire(snapshot),
      hash = digest(JSON.stringify(wire));
    return this.transaction(async (db) => {
      const member = await this.member(db, snapshot.externalStudentId),
        scope = [this.config.campaignId, member.actor_id];
      const existing = (
        await db.query<{
          payload_hash: Buffer;
          receipt: Record<string, unknown>;
        }>(
          "SELECT payload_hash,receipt FROM r2pl_v2.portal_running_receipts WHERE campaign_id=$1 AND actor_id=$2 AND revision=$3",
          [...scope, snapshot.revision.toString()],
        )
      ).rows[0];
      if (existing) {
        if (!existing.payload_hash.equals(hash))
          throw new PortalError(409, "REVISION_CONFLICT");
        return { ...existing.receipt, replay: true };
      }
      if (
        snapshot.observedAtMs >
          Date.now() + GAME_CONFIG.integration.requestSkewMs ||
        Date.now() - snapshot.observedAtMs >
          GAME_CONFIG.integration.requestSkewMs
      )
        throw new PortalError(400, "INVALID_SNAPSHOT_TIME_OR_DISTANCE");
      const before = (
        await db.query<{ data: RunningState }>(
          "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='running' AND id=$2",
          scope,
        )
      ).rows[0]?.data;
      if (
        before &&
        (snapshot.revision <= BigInt(before.revision) ||
          snapshot.observedAtMs < before.observedAtMs)
      )
        throw new PortalError(409, "STALE_REVISION");
      const rate = GAME_CONFIG.running.kmToPointsRate;
      if (before && before.pointsPerKm !== rate)
        throw new PortalError(409, "CONVERSION_CHANGE_REQUIRES_REVIEW");
      const total = (snapshot.cumulativeMeters * BigInt(rate)) / 1000n;
      if (total > BigInt(Number.MAX_SAFE_INTEGER))
        throw new PortalError(400, "POINTS_OVERFLOW");
      const delta = total - BigInt(before?.attributedPoints ?? 0);
      const wallet = (
        await db.query<{ balance: string }>(
          "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit' FOR UPDATE",
          scope,
        )
      ).rows[0]!;
      const next = BigInt(wallet.balance) + delta;
      if (next < 0n) throw new PortalError(409, "CORRECTION_REQUIRES_REVIEW");
      if (next > 9_223_372_036_854_775_807n)
        throw new PortalError(400, "POINTS_OVERFLOW");
      const key = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
      const receipt = {
        externalStudentId: snapshot.externalStudentId,
        revision: snapshot.revision.toString(),
        earnedRunningPoints: total.toString(),
        spendablePoints: next.toString(),
        delta: delta.toString(),
        replay: false,
      };
      await db.query(
        "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
        [...scope, key, hash, JSON.stringify(receipt)],
      );
      await db.query(
        "UPDATE r2pl_v2.wallet_accounts SET balance=$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
        [...scope, next.toString()],
      );
      if (delta !== 0n)
        await db.query(
          "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'fixture-credit',$4)",
          [...scope, key, delta.toString()],
        );
      const state: RunningState = {
        revision: snapshot.revision.toString(),
        meters: Number(snapshot.cumulativeMeters),
        weeklyMeters: Number(snapshot.weeklyMeters),
        week: snapshot.weekStartMs,
        attributedPoints: Number(total),
        observedAtMs: snapshot.observedAtMs,
        pointsPerKm: rate,
      };
      await db.query(
        "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'running',$2,$3) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
        [...scope, JSON.stringify(state)],
      );
      await db.query(
        "INSERT INTO r2pl_v2.portal_running_receipts(campaign_id,actor_id,revision,payload_hash,receipt) VALUES($1,$2,$3,$4,$5)",
        [...scope, snapshot.revision.toString(), hash, JSON.stringify(receipt)],
      );
      await db.query(
        "INSERT INTO r2pl_v2.game_events(campaign_id,actor_id,title,body) VALUES($1,$2,'Đồng bộ thành tích chạy',$3)",
        [...scope, `Thành tích chạy đã đồng bộ: ${delta} Điểm`],
      );
      return receipt;
    });
  }
  async account(input: unknown): Promise<unknown> {
    const value = portalObject(input, ["externalStudentId"]);
    return this.transaction(async (db) => {
      const member = await this.member(db, value.externalStudentId);
      const row = (
        await db.query<{ balance: string; data: RunningState | null }>(
          "SELECT w.balance::text,g.data FROM r2pl_v2.wallet_accounts w LEFT JOIN r2pl_v2.game_state g ON g.campaign_id=w.campaign_id AND g.scope='running' AND g.id=w.actor_id::text WHERE w.campaign_id=$1 AND w.actor_id=$2 AND w.resource='fixture-credit'",
          [this.config.campaignId, member.actor_id],
        )
      ).rows[0]!;
      return {
        externalStudentId: member.external_student_id,
        schoolId: member.school_id,
        earnedRunningPoints: String(row.data?.attributedPoints ?? 0),
        spendablePoints: row.balance,
        revision: row.data?.revision ?? "0",
        cumulativeMeters: String(row.data?.meters ?? 0),
        weeklyMeters: String(row.data?.weeklyMeters ?? 0),
        weekStartMs: row.data?.week ?? null,
      };
    });
  }
  async launch(input: unknown): Promise<unknown> {
    const value = portalObject(input, ["externalStudentId", "codeChallenge"]);
    if (
      typeof value.codeChallenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.codeChallenge)
    )
      throw new PortalError(400, "INVALID_CODE_CHALLENGE");
    return this.transaction(async (db) => {
      assertIdentifier(value.externalStudentId);
      const admin = (
        await db.query<{ actor_id: string; active: boolean }>(
          "SELECT actor_id,(active AND access_enabled AND NOT protected_root) AS active FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND external_student_id=$2 FOR UPDATE",
          [this.config.campaignId, value.externalStudentId],
        )
      ).rows[0];
      if (admin) {
        if (!admin.active) throw new PortalError(403, "MEMBER_SUSPENDED");
        const ticket = randomBytes(32).toString("hex");
        await db.query(
          "DELETE FROM r2pl_v2.portal_admin_launches WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
          [this.config.campaignId],
        );
        await db.query(
          "INSERT INTO r2pl_v2.portal_admin_launches(campaign_id,ticket_hash,actor_id,challenge,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+($5::bigint*interval '1 millisecond'))",
          [
            this.config.campaignId,
            digest(ticket),
            admin.actor_id,
            value.codeChallenge,
            GAME_CONFIG.integration.launchTtlMs,
          ],
        );
        return {
          launchUrl: `${this.config.publicOrigin}/#launch=${ticket}`,
          expiresInSeconds: GAME_CONFIG.integration.launchTtlMs / 1000,
        };
      }
      const member = await this.member(db, value.externalStudentId),
        ticket = randomBytes(32).toString("hex");
      await db.query(
        "DELETE FROM r2pl_v2.portal_launches WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
        [this.config.campaignId],
      );
      await db.query(
        "INSERT INTO r2pl_v2.portal_launches(campaign_id,ticket_hash,actor_id,challenge,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+($5::bigint*interval '1 millisecond'))",
        [
          this.config.campaignId,
          digest(ticket),
          member.actor_id,
          value.codeChallenge,
          GAME_CONFIG.integration.launchTtlMs,
        ],
      );
      return {
        launchUrl: `${this.config.publicOrigin}/#launch=${ticket}`,
        expiresInSeconds: GAME_CONFIG.integration.launchTtlMs / 1000,
      };
    });
  }
  async exchange(
    input: unknown,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const value = portalObject(input, ["ticket", "codeVerifier"]);
    if (
      typeof value.ticket !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.ticket) ||
      typeof value.codeVerifier !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(value.codeVerifier)
    )
      throw new PortalError(401, "INVALID_LAUNCH");
    return this.transaction(async (db) => {
      const adminLaunch = (
        await db.query<{ actor_id: string; challenge: string }>(
          "SELECT l.actor_id,l.challenge FROM r2pl_v2.portal_admin_launches l JOIN r2pl_v2.portal_admins a USING(campaign_id,actor_id) WHERE l.campaign_id=$1 AND l.ticket_hash=$2 AND l.expires_at>clock_timestamp() AND a.active AND a.access_enabled AND NOT a.protected_root FOR UPDATE OF l,a",
          [this.config.campaignId, digest(value.ticket as string)],
        )
      ).rows[0];
      if (adminLaunch) {
        if (
          adminLaunch.challenge !==
          digest(value.codeVerifier as string).toString("base64url")
        )
          throw new PortalError(401, "INVALID_LAUNCH");
        await db.query(
          "DELETE FROM r2pl_v2.portal_admin_launches WHERE campaign_id=$1 AND ticket_hash=$2",
          [this.config.campaignId, digest(value.ticket as string)],
        );
        await db.query(
          "DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
          [this.config.campaignId],
        );
        const token = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO r2pl_v2.portal_admin_sessions(campaign_id,token_hash,actor_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'))",
          [
            this.config.campaignId,
            digest(token),
            adminLaunch.actor_id,
            GAME_CONFIG.integration.sessionTtlMs,
          ],
        );
        const access = await authenticateAdminAccess(
          db,
          this.config.campaignId,
          token,
        );
        if (access?.playable)
          await bindTestProfile(
            db,
            this.config.campaignId,
            adminLaunch.actor_id,
            token,
          );
        return {
          token,
          expiresInSeconds: GAME_CONFIG.integration.sessionTtlMs / 1000,
        };
      }
      const row = (
        await db.query<{ actor_id: string; challenge: string }>(
          "SELECT l.actor_id,l.challenge FROM r2pl_v2.portal_launches l JOIN r2pl_v2.portal_members m USING(campaign_id,actor_id) WHERE l.campaign_id=$1 AND l.ticket_hash=$2 AND l.expires_at>clock_timestamp() AND m.active FOR UPDATE OF l,m",
          [this.config.campaignId, digest(value.ticket as string)],
        )
      ).rows[0];
      if (
        !row ||
        row.challenge !==
          digest(value.codeVerifier as string).toString("base64url")
      )
        throw new PortalError(401, "INVALID_LAUNCH");
      await db.query(
        "DELETE FROM r2pl_v2.portal_launches WHERE campaign_id=$1 AND ticket_hash=$2",
        [this.config.campaignId, digest(value.ticket as string)],
      );
      await db.query(
        "DELETE FROM r2pl_v2.portal_sessions WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
        [this.config.campaignId],
      );
      const token = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO r2pl_v2.portal_sessions(campaign_id,token_hash,actor_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'))",
        [
          this.config.campaignId,
          digest(token),
          row.actor_id,
          GAME_CONFIG.integration.sessionTtlMs,
        ],
      );
      return {
        token,
        expiresInSeconds: GAME_CONFIG.integration.sessionTtlMs / 1000,
      };
    });
  }
  async authenticate(token: unknown): Promise<SchoolPlayActor | undefined> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      return undefined;
    return this.authenticateHash(digest(token).toString("hex"), token);
  }
  async authenticateHash(
    hash: string,
    token = "",
  ): Promise<SchoolPlayActor | undefined> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return undefined;
    const row = (
      await this.pool.query<Member>(
        `SELECT m.* FROM r2pl_v2.portal_sessions s JOIN r2pl_v2.portal_members m USING(campaign_id,actor_id)
         LEFT JOIN r2pl_v2.partner_test_profiles p USING(campaign_id,actor_id)
         LEFT JOIN r2pl_v2.portal_admins a ON a.campaign_id=p.campaign_id AND a.actor_id=p.owner_actor_id
         WHERE s.campaign_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp() AND m.active
         AND (p.actor_id IS NULL OR (a.active AND a.access_enabled AND a.test_profiles AND EXISTS(
           SELECT 1 FROM r2pl_v2.portal_admin_sessions ads WHERE ads.campaign_id=a.campaign_id AND ads.actor_id=a.actor_id
           AND ads.token_hash=s.token_hash AND ads.expires_at>clock_timestamp())))`,
        [this.config.campaignId, Buffer.from(hash, "hex")],
      )
    ).rows[0];
    if (!row) return undefined;
    return {
      token,
      actorId: row.actor_id,
      schoolSlot: row.school_slot,
      name: row.display_name,
      schoolName: SCHOOLS[row.school_slot]!.shortName,
      role: "human",
      ordinal: 0,
    };
  }
  async logout(token: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND token_hash=$2",
      [this.config.campaignId, digest(token)],
    );
    await this.pool.query(
      "DELETE FROM r2pl_v2.portal_sessions WHERE campaign_id=$1 AND token_hash=$2",
      [this.config.campaignId, digest(token)],
    );
  }
  async socketTicket(token: string): Promise<string> {
    const admin = await this.authenticateAdmin(token);
    if (admin && !admin.playable)
      throw new PortalError(403, "ADMIN_CANNOT_PLAY");
    return this.transaction(async (db) => {
      const sessionHash = digest(token);
      const session = await db.query(
        "SELECT 1 FROM r2pl_v2.portal_sessions s JOIN r2pl_v2.portal_members m USING(campaign_id,actor_id) WHERE s.campaign_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp() AND m.active FOR SHARE OF s,m",
        [this.config.campaignId, sessionHash],
      );
      if (!session.rowCount) throw new PortalError(401, "UNAUTHORIZED");
      await db.query(
        "DELETE FROM r2pl_v2.portal_socket_tickets WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
        [this.config.campaignId],
      );
      const ticket = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO r2pl_v2.portal_socket_tickets(campaign_id,ticket_hash,session_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'))",
        [
          this.config.campaignId,
          digest(ticket),
          sessionHash,
          GAME_CONFIG.integration.socketTicketTtlMs,
        ],
      );
      return ticket;
    });
  }
  async consumeSocketTicket(
    ticket: unknown,
  ): Promise<{ actor: SchoolPlayActor; sessionHash: string }> {
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket))
      throw new PortalError(401, "UNAUTHORIZED");
    const row = (
      await this.pool.query<{ session_hash: Buffer }>(
        "DELETE FROM r2pl_v2.portal_socket_tickets WHERE campaign_id=$1 AND ticket_hash=$2 AND expires_at>clock_timestamp() RETURNING session_hash",
        [this.config.campaignId, digest(ticket)],
      )
    ).rows[0];
    const actor = row
      ? await this.authenticateHash(row.session_hash.toString("hex"))
      : undefined;
    if (!row || !actor) throw new PortalError(401, "UNAUTHORIZED");
    return { actor, sessionHash: row.session_hash.toString("hex") };
  }
}

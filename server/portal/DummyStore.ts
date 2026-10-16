import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { R2plPartnerClient } from "../../integration/partner-client.mjs";
import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import {
  AMTECH_ACCOUNTS,
  isAmtechIdentity,
} from "../../shared/integration/identity.ts";
import { campaignWeekStart } from "../../shared/integration/running.ts";
import type { PortalConfig } from "../integration/PortalConfig.ts";
import { PortalError } from "../integration/PortalSignature.ts";
import { portalObject } from "../integration/PortalStore.ts";

const hash = (token: string) => createHash("sha256").update(token).digest();
const derive = promisify(scrypt);
export interface DummyStudent {
  id: string;
  email: string;
  display_name: string;
  school_id: string;
  revision: string;
}
export class DummyStore {
  readonly pool: Pool;
  readonly config: PortalConfig;
  readonly partner: R2plPartnerClient;
  constructor(pool: Pool, config: PortalConfig) {
    if (config.mode !== "staging")
      throw new Error("Dummy portal is staging only");
    this.pool = pool;
    this.config = config;
    const [keyId, secret] = Object.entries(config.keys)[0]!;
    this.partner = new R2plPartnerClient({
      origin: config.publicOrigin,
      campaignId: config.campaignId,
      keyId,
      secret,
    });
  }
  async initialize(): Promise<void> {
    await this.transaction(async (db) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('r2pl-dummy-schema',0))",
      );
      await db.query(
        await readFile(
          new URL("../../database/dummy/001_portal.sql", import.meta.url),
          "utf8",
        ),
      );
    });
  }
  /** Explicit local CLI setup only; self-service registration can never call this. */
  async seedAdminAccounts(password: string): Promise<void> {
    if (password.length < 10 || password.length > 128)
      throw new TypeError("Invalid local test password");
    const target = new URL(this.pool.options.connectionString!);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !/^r2pl_(prep|bot)_test_/.test(target.pathname.slice(1))
    )
      throw new Error("Admin seeding requires a disposable local database");
    for (const account of AMTECH_ACCOUNTS) {
      const salt = randomBytes(32),
        encoded = (await derive(password, salt, 64)) as Buffer;
      await this.pool.query(
        "INSERT INTO r2pl_dummy.students(campaign_id,id,email,display_name,school_id,password_hash,password_salt) VALUES($1,$2,$3,$4,'amtech',$5,$6) ON CONFLICT(campaign_id,email) DO UPDATE SET school_id='amtech',display_name=EXCLUDED.display_name",
        [
          this.config.campaignId,
          randomUUID(),
          account.email,
          account.name,
          encoded,
          salt,
        ],
      );
    }
  }
  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='5s'");
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
  async rateLimit(source: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM r2pl_dummy.rate_windows WHERE campaign_id=$1 AND window_id<floor(extract(epoch FROM clock_timestamp())/60)::bigint-1",
      [this.config.campaignId],
    );
    const result = (
      await this.pool.query<{ requests: number }>(
        "INSERT INTO r2pl_dummy.rate_windows(campaign_id,source_hash,window_id,requests) VALUES($1,$2,floor(extract(epoch FROM clock_timestamp())/60)::bigint,1) ON CONFLICT(campaign_id,source_hash,window_id) DO UPDATE SET requests=rate_windows.requests+1 RETURNING requests",
        [this.config.campaignId, hash(source)],
      )
    ).rows[0]!;
    if (result.requests > GAME_CONFIG.integration.dummyAuthRequestsPerMinute)
      throw new PortalError(429, "THỬ_LẠI_SAU");
  }
  private credentials(input: unknown): {
    email: string;
    password: string;
    value: Record<string, unknown>;
  } {
    const value = portalObject(input, [
      "email",
      "password",
      "displayName",
      "schoolId",
    ]);
    if (
      typeof value.email !== "string" ||
      value.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
      typeof value.password !== "string" ||
      value.password.length < 10 ||
      value.password.length > 128
    )
      throw new PortalError(
        400,
        "Email hợp lệ và mật khẩu từ 10–128 ký tự là bắt buộc.",
      );
    return {
      email: value.email.trim().toLowerCase(),
      password: value.password,
      value,
    };
  }
  async register(input: unknown): Promise<DummyStudent> {
    const { email, password, value } = this.credentials(input);
    if (isAmtechIdentity(email, true))
      throw new PortalError(
        403,
        "Tài khoản AMTECH cần được xác thực bởi Portal đối tác, không đăng ký qua tài khoản sinh viên thử nghiệm.",
      );
    if (
      typeof value.displayName !== "string" ||
      value.displayName.trim().length < 2 ||
      value.displayName.length > 100 ||
      [...value.displayName].some((c) => c.charCodeAt(0) < 32) ||
      !SCHOOLS.some((school) => school.id === value.schoolId)
    )
      throw new PortalError(400, "Vui lòng nhập tên sinh viên và chọn trường.");
    const salt = randomBytes(32),
      encoded = (await derive(password, salt, 64)) as Buffer;
    const row = (
      await this.pool.query<DummyStudent>(
        "INSERT INTO r2pl_dummy.students(campaign_id,id,email,display_name,school_id,password_hash,password_salt) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(campaign_id,email) DO NOTHING RETURNING id,email,display_name,school_id,revision::text",
        [
          this.config.campaignId,
          randomUUID(),
          email,
          value.displayName.trim(),
          value.schoolId,
          encoded,
          salt,
        ],
      )
    ).rows[0];
    if (!row)
      throw new PortalError(409, "Email này đã có tài khoản. Hãy đăng nhập.");
    return row;
  }
  async login(input: unknown): Promise<DummyStudent> {
    const { email, password } = this.credentials(input);
    const row = (
      await this.pool.query<
        DummyStudent & { password_hash: Buffer; password_salt: Buffer }
      >("SELECT * FROM r2pl_dummy.students WHERE campaign_id=$1 AND email=$2", [
        this.config.campaignId,
        email,
      ])
    ).rows[0];
    const encoded = (await derive(
      password,
      row?.password_salt ?? Buffer.alloc(32),
      64,
    )) as Buffer;
    if (!row || !timingSafeEqual(encoded, row.password_hash))
      throw new PortalError(401, "Email hoặc mật khẩu chưa đúng.");
    return {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      school_id: row.school_id,
      revision: row.revision,
    };
  }
  async createSession(student: DummyStudent): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await this.pool.query(
      "DELETE FROM r2pl_dummy.sessions WHERE campaign_id=$1 AND expires_at<=clock_timestamp()",
      [this.config.campaignId],
    );
    await this.pool.query(
      "INSERT INTO r2pl_dummy.sessions(campaign_id,token_hash,student_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'))",
      [
        this.config.campaignId,
        hash(token),
        student.id,
        GAME_CONFIG.integration.dummySessionTtlMs,
      ],
    );
    return token;
  }
  async authenticate(
    token: string | undefined,
  ): Promise<DummyStudent | undefined> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    return (
      await this.pool.query<DummyStudent>(
        "SELECT u.id,u.email,u.display_name,u.school_id,u.revision::text FROM r2pl_dummy.sessions s JOIN r2pl_dummy.students u ON u.campaign_id=s.campaign_id AND u.id=s.student_id WHERE s.campaign_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp()",
        [this.config.campaignId, hash(token)],
      )
    ).rows[0];
  }
  async logout(token: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM r2pl_dummy.sessions WHERE campaign_id=$1 AND token_hash=$2",
      [this.config.campaignId, hash(token)],
    );
  }
  async provision(student: DummyStudent): Promise<void> {
    await this.partner.request("members", {
      externalStudentId: student.id,
      schoolId: student.school_id,
      displayName: student.display_name,
      eduVerified: true,
      active: true,
      ...(student.school_id === "amtech"
        ? { email: student.email, emailVerified: true }
        : {}),
    });
  }
  private async enqueue(db: PoolClient, student: DummyStudent): Promise<void> {
    const now = Date.now(),
      week = campaignWeekStart(now);
    const totals = (
      await db.query<{ meters: string; weekly: string }>(
        "SELECT COALESCE(sum(meters),0)::text AS meters,COALESCE(sum(meters) FILTER (WHERE occurred_at >= $3),0)::text AS weekly FROM r2pl_dummy.activities WHERE campaign_id=$1 AND student_id=$2",
        [this.config.campaignId, student.id, week],
      )
    ).rows[0]!;
    const revision = (
      await db.query<{ revision: string }>(
        "UPDATE r2pl_dummy.students SET revision=revision+1 WHERE campaign_id=$1 AND id=$2 RETURNING revision::text",
        [this.config.campaignId, student.id],
      )
    ).rows[0]!.revision;
    const payload = {
      externalStudentId: student.id,
      revision,
      cumulativeMeters: totals.meters,
      weeklyMeters: totals.weekly,
      observedAtMs: now,
      weekStartMs: week,
    };
    await db.query(
      "INSERT INTO r2pl_dummy.sync_jobs(campaign_id,student_id,revision,payload) VALUES($1,$2,$3,$4)",
      [this.config.campaignId, student.id, revision, JSON.stringify(payload)],
    );
  }
  async addActivity(student: DummyStudent, input: unknown): Promise<void> {
    if (student.school_id === "amtech")
      throw new PortalError(403, "ADMIN_CANNOT_PLAY");
    const value = portalObject(input, ["meters", "occurredAtMs", "id"]);
    if (
      typeof value.meters !== "number" ||
      !Number.isSafeInteger(value.meters) ||
      value.meters < 1 ||
      value.meters > GAME_CONFIG.integration.dummyMaxActivityMeters ||
      typeof value.occurredAtMs !== "number" ||
      !Number.isSafeInteger(value.occurredAtMs) ||
      value.occurredAtMs < 0 ||
      value.occurredAtMs > Date.now() ||
      typeof value.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        value.id,
      )
    )
      throw new PortalError(
        400,
        "Quãng đường hoặc thời gian chạy chưa hợp lệ.",
      );
    await this.transaction(async (db) => {
      await db.query(
        "SELECT 1 FROM r2pl_dummy.students WHERE campaign_id=$1 AND id=$2 FOR UPDATE",
        [this.config.campaignId, student.id],
      );
      const old = (
        await db.query<{
          student_id: string;
          meters: string;
          occurred_at: string;
        }>(
          "SELECT student_id,meters::text,occurred_at::text FROM r2pl_dummy.activities WHERE campaign_id=$1 AND id=$2",
          [this.config.campaignId, value.id],
        )
      ).rows[0];
      if (old) {
        if (
          old.student_id !== student.id ||
          old.meters !== String(value.meters) ||
          old.occurred_at !== String(value.occurredAtMs)
        )
          throw new PortalError(409, "ACTIVITY_CONFLICT");
        return;
      }
      await db.query(
        "INSERT INTO r2pl_dummy.activities(campaign_id,id,student_id,meters,occurred_at) VALUES($1,$2,$3,$4,$5)",
        [
          this.config.campaignId,
          value.id,
          student.id,
          value.meters,
          value.occurredAtMs,
        ],
      );
      await this.enqueue(db, student);
    });
  }
  async retry(student: DummyStudent): Promise<void> {
    await this.pool.query(
      "UPDATE r2pl_dummy.sync_jobs SET next_attempt=clock_timestamp() WHERE campaign_id=$1 AND student_id=$2 AND state IN ('pending','failed')",
      [this.config.campaignId, student.id],
    );
  }
  async syncNext(): Promise<boolean> {
    const job = await this.transaction(async (db) => {
      const row = (
        await db.query<{
          id: string;
          student_id: string;
          payload: Record<string, unknown>;
          attempts: number;
        }>(
          "SELECT j.id::text,j.student_id,j.payload,j.attempts FROM r2pl_dummy.sync_jobs j WHERE j.campaign_id=$1 AND ((j.state IN ('pending','failed') AND j.next_attempt<=clock_timestamp()) OR (j.state='sending' AND j.lease_until<clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM r2pl_dummy.sync_jobs p WHERE p.campaign_id=j.campaign_id AND p.student_id=j.student_id AND p.revision<j.revision AND p.state NOT IN ('synced','superseded')) ORDER BY j.id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [this.config.campaignId],
        )
      ).rows[0];
      const leaseToken = randomUUID();
      if (row)
        await db.query(
          "UPDATE r2pl_dummy.sync_jobs SET state='sending',attempts=attempts+1,lease_until=clock_timestamp()+interval '30 seconds',lease_token=$2 WHERE id=$1",
          [row.id, leaseToken],
        );
      return row ? { ...row, leaseToken } : undefined;
    });
    if (!job) return false;
    try {
      const student = (
        await this.pool.query<DummyStudent>(
          "SELECT id,email,display_name,school_id,revision::text FROM r2pl_dummy.students WHERE campaign_id=$1 AND id=$2",
          [this.config.campaignId, job.student_id],
        )
      ).rows[0]!;
      await this.provision(student);
      const receipt = await this.partner.request("running", job.payload);
      await this.pool.query(
        "UPDATE r2pl_dummy.sync_jobs SET state='synced',receipt=$2,error_code=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$3",
        [job.id, JSON.stringify(receipt), job.leaseToken],
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNAVAILABLE";
      if (code === "INVALID_SNAPSHOT_TIME_OR_DISTANCE") {
        await this.transaction(async (db) => {
          const owned = await db.query(
            "SELECT 1 FROM r2pl_dummy.sync_jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [job.id, job.leaseToken],
          );
          if (!owned.rowCount) return;
          const student = (
            await db.query<DummyStudent>(
              "SELECT id,email,display_name,school_id,revision::text FROM r2pl_dummy.students WHERE campaign_id=$1 AND id=$2 FOR UPDATE",
              [this.config.campaignId, job.student_id],
            )
          ).rows[0]!;
          await db.query(
            "UPDATE r2pl_dummy.sync_jobs SET state='superseded',lease_until=NULL WHERE id=$1",
            [job.id],
          );
          await this.enqueue(db, student);
        });
      } else
        await this.pool.query(
          "UPDATE r2pl_dummy.sync_jobs SET state='failed',error_code=$2,lease_until=NULL,next_attempt=clock_timestamp()+($3::bigint*interval '1 millisecond') WHERE id=$1 AND lease_token=$4",
          [
            job.id,
            code.slice(0, 120),
            Math.min(60_000, 1000 * 2 ** Math.min(job.attempts, 6)),
            job.leaseToken,
          ],
        );
    }
    return true;
  }
  async dashboard(student: DummyStudent): Promise<unknown> {
    if (student.school_id === "amtech") {
      await this.provision(student);
      return {
        student: {
          id: student.id,
          email: student.email,
          displayName: student.display_name,
          schoolId: null,
          organizationId: "amtech",
          role: "admin",
          playable: false,
        },
        activities: [],
        jobs: [],
        account: null,
        ranking: [],
      };
    }
    const scope = [this.config.campaignId, student.id];
    const activities = (
      await this.pool.query(
        "SELECT id,meters::text,occurred_at::text FROM r2pl_dummy.activities WHERE campaign_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 50",
        scope,
      )
    ).rows;
    const jobs = (
      await this.pool.query(
        "SELECT revision::text,state,error_code FROM r2pl_dummy.sync_jobs WHERE campaign_id=$1 AND student_id=$2 ORDER BY revision DESC LIMIT 10",
        scope,
      )
    ).rows;
    let account: Record<string, unknown> | null = null;
    try {
      await this.provision(student);
      account = await this.partner.request("accounts", {
        externalStudentId: student.id,
      });
    } catch {
      /* Durable activities remain visible while game is offline. */
    }
    const ranking = (
      await this.pool.query(
        "SELECT u.display_name,u.school_id,COALESCE(sum(a.meters),0)::text AS meters FROM r2pl_dummy.students u LEFT JOIN r2pl_dummy.activities a ON a.campaign_id=u.campaign_id AND a.student_id=u.id WHERE u.campaign_id=$1 AND u.school_id <> 'amtech' GROUP BY u.id,u.display_name,u.school_id ORDER BY COALESCE(sum(a.meters),0) DESC,u.id LIMIT 20",
        [this.config.campaignId],
      )
    ).rows;
    return {
      student: {
        id: student.id,
        email: student.email,
        displayName: student.display_name,
        schoolId: student.school_id,
      },
      activities,
      jobs,
      account,
      ranking,
    };
  }
}

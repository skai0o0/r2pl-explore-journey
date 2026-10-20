import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import {
  ADMIN_ROLES,
  type AdminAccountView,
  type AdminPermission,
  ALL_ADMIN_PERMISSIONS,
  defaultAdminPermissions,
  isStaffSsoEmail,
  ROOT_ADMIN_EMAIL,
} from "../../shared/integration/adminAccess.ts";
import type { AdminPrincipal } from "../../shared/integration/identity.ts";
import {
  bindTestProfile,
  provisionTestProfiles,
  revokeTestPlay,
} from "./PartnerTestProfiles.ts";
import { PortalError } from "./PortalSignature.ts";

const derive = promisify(scrypt);
const hash = (token: string) => createHash("sha256").update(token).digest();
interface AccessRow {
  actor_id: string;
  email: string;
  display_name: string;
  active: boolean;
  access_enabled: boolean;
  permissions: AdminPermission[] | null;
  protected_root: boolean;
  access_revision: number;
  password_hash: Buffer | null;
  password_salt: Buffer | null;
  test_profiles: boolean;
}
export const effectivePermissions = (
  row: Pick<AccessRow, "protected_root" | "email" | "permissions">,
): readonly AdminPermission[] =>
  row.protected_root
    ? ALL_ADMIN_PERMISSIONS
    : (row.permissions ?? defaultAdminPermissions(row.email));

export async function authenticateAdminAccess(
  db: Pool | PoolClient,
  campaign: string,
  token: unknown,
): Promise<AdminPrincipal | undefined> {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    return undefined;
  const row = (
    await db.query<AccessRow>(
      `SELECT a.* FROM r2pl_v2.portal_admins a JOIN r2pl_v2.portal_admin_sessions s USING(campaign_id,actor_id)
     WHERE a.campaign_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp()
     AND (a.protected_root OR (a.active AND a.access_enabled))`,
      [campaign, hash(token)],
    )
  ).rows[0];
  return row
    ? {
        actorId: row.actor_id,
        name: row.display_name,
        email: row.email,
        organizationId: "amtech",
        role: "admin",
        playable: row.test_profiles,
        permissions: effectivePermissions(row),
        protectedRoot: row.protected_root,
      }
    : undefined;
}
/** Call inside the same campaign-locked transaction as the mutation. */
export async function requireAdminPermission(
  db: Pool | PoolClient,
  campaign: string,
  actor: string,
  token: string,
  permission: AdminPermission,
): Promise<AdminPrincipal> {
  const admin = await authenticateAdminAccess(db, campaign, token);
  if (!admin || admin.actorId !== actor)
    throw new PortalError(403, "ADMIN_REQUIRED");
  if (!admin.permissions?.includes(permission))
    throw new PortalError(403, "PERMISSION_DENIED");
  return admin;
}
function emailValue(value: unknown): string {
  if (typeof value !== "string") throw new PortalError(400, "INVALID_EMAIL");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new PortalError(400, "INVALID_EMAIL");
  return email;
}
function nameValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 100 ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new PortalError(400, "INVALID_NAME");
  return value.trim();
}
export async function passwordCredentials(
  password: unknown,
): Promise<{ salt: Buffer; encoded: Buffer }> {
  const c = GAME_CONFIG.adminAccess;
  if (
    typeof password !== "string" ||
    password.length < c.minPasswordLength ||
    password.length > c.maxPasswordLength
  )
    throw new PortalError(400, "INVALID_PASSWORD_LENGTH");
  const salt = randomBytes(32);
  return { salt, encoded: (await derive(password, salt, 64)) as Buffer };
}
function view(row: AccessRow): AdminAccountView {
  return {
    actorId: row.actor_id,
    email: row.email,
    name: row.display_name,
    enabled: row.protected_root || (row.active && row.access_enabled),
    permissions: effectivePermissions(row),
    protectedRoot: row.protected_root,
    login: row.password_hash ? "password" : "portal",
    revision: row.access_revision,
    testProfiles: row.test_profiles,
  };
}
export class AdminAccessStore {
  private pool: Pool;
  private campaign: string;
  constructor(pool: Pool, campaign: string) {
    this.pool = pool;
    this.campaign = campaign;
  }
  private async locked<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
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
  async list(actor: string, token: string): Promise<AdminAccountView[]> {
    return this.locked(async (db) => {
      await requireAdminPermission(
        db,
        this.campaign,
        actor,
        token,
        "admins.manage",
      );
      return (
        await db.query<AccessRow>(
          "SELECT * FROM r2pl_v2.portal_admins WHERE campaign_id=$1 ORDER BY protected_root DESC,email LIMIT $2",
          [this.campaign, GAME_CONFIG.adminAccess.accountLimit],
        )
      ).rows.map(view);
    });
  }
  async audit(actor: string, token: string): Promise<unknown[]> {
    return this.locked(async (db) => {
      await requireAdminPermission(
        db,
        this.campaign,
        actor,
        token,
        "audit.view",
      );
      return (
        await db.query(
          `SELECT o.id::text, o.action,o.detail,o.created_at::text AS "createdAt",a.display_name AS actor FROM r2pl_v2.operator_audit o LEFT JOIN r2pl_v2.portal_admins a USING(campaign_id,actor_id) WHERE o.campaign_id=$1 ORDER BY o.id DESC LIMIT $2`,
          [this.campaign, GAME_CONFIG.adminAccess.auditLimit],
        )
      ).rows;
    });
  }
  async save(
    actor: string,
    token: string,
    input: unknown,
  ): Promise<AdminAccountView> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new PortalError(400, "INVALID_BODY");
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (k) =>
          ![
            "email",
            "name",
            "permissions",
            "enabled",
            "expectedRevision",
            "password",
            "testProfiles",
          ].includes(k),
      )
    )
      throw new PortalError(400, "INVALID_BODY");
    const email = emailValue(v.email),
      name = nameValue(v.name);
    if (email === ROOT_ADMIN_EMAIL)
      throw new PortalError(403, "ROOT_ADMIN_PROTECTED");
    if (
      typeof v.enabled !== "boolean" ||
      !Number.isSafeInteger(v.expectedRevision) ||
      Number(v.expectedRevision) < 0 ||
      !Array.isArray(v.permissions) ||
      v.permissions.some((p) => !ALL_ADMIN_PERMISSIONS.includes(p))
    )
      throw new PortalError(400, "INVALID_PERMISSIONS");
    const permissions = [...new Set(v.permissions as AdminPermission[])];
    if (v.testProfiles !== undefined && typeof v.testProfiles !== "boolean")
      throw new PortalError(400, "INVALID_BODY");
    if (
      (permissions.includes("map.edit") && !permissions.includes("map.view")) ||
      (permissions.includes("map.publish") && !permissions.includes("map.edit"))
    )
      throw new PortalError(400, "MAP_PERMISSION_DEPENDENCY");
    // Only explicitly play-only test accounts may receive a separate Game password.
    // Other staff continue to use Portal SSO; root remains operator-managed.
    if (
      v.password !== undefined &&
      isStaffSsoEmail(email) &&
      !(v.testProfiles === true && permissions.length === 0)
    )
      throw new PortalError(400, "STAFF_USES_PORTAL");
    // Authenticate before spending password hashing work, then revalidate in the write transaction.
    const current = await requireAdminPermission(
      this.pool,
      this.campaign,
      actor,
      token,
      "admins.manage",
    );
    if (permissions.some((p) => !current.permissions?.includes(p)))
      throw new PortalError(403, "CANNOT_GRANT_PERMISSION");
    const credentials =
      v.password === undefined
        ? undefined
        : await passwordCredentials(v.password);
    return this.locked(async (db) => {
      const admin = await requireAdminPermission(
        db,
        this.campaign,
        actor,
        token,
        "admins.manage",
      );
      const old = (
        await db.query<AccessRow>(
          "SELECT * FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND email=$2 FOR UPDATE",
          [this.campaign, email],
        )
      ).rows[0];
      if (old?.protected_root)
        throw new PortalError(403, "ROOT_ADMIN_PROTECTED");
      const testProfiles = v.testProfiles ?? old?.test_profiles ?? false;
      if (
        testProfiles &&
        permissions.some(
          (p) =>
            !(
              ADMIN_ROLES.partner.permissions as readonly AdminPermission[]
            ).includes(p),
        )
      )
        throw new PortalError(400, "TEST_PROFILE_READ_ONLY");
      if (
        permissions.some((p) => !admin.permissions?.includes(p)) ||
        (old &&
          effectivePermissions(old).some(
            (p) => !admin.permissions?.includes(p),
          ))
      )
        throw new PortalError(403, "CANNOT_GRANT_PERMISSION");
      if (old?.actor_id === actor)
        throw new PortalError(403, "CANNOT_EDIT_SELF");
      if ((old?.access_revision ?? 0) !== v.expectedRevision)
        throw new PortalError(409, "ADMIN_VERSION_CONFLICT");
      if (!old && !isStaffSsoEmail(email) && !credentials)
        throw new PortalError(400, "PASSWORD_REQUIRED");
      if (
        !old &&
        Number(
          (
            await db.query<{ count: string }>(
              "SELECT count(*) FROM r2pl_v2.portal_admins WHERE campaign_id=$1",
              [this.campaign],
            )
          ).rows[0]!.count,
        ) >= GAME_CONFIG.adminAccess.accountLimit
      )
        throw new PortalError(400, "ADMIN_ACCOUNT_LIMIT");
      const row = (
        await db.query<AccessRow>(
          `INSERT INTO r2pl_v2.portal_admins(campaign_id,external_student_id,actor_id,organization_id,email,display_name,active,access_enabled,permissions,access_revision,password_hash,password_salt,test_profiles)
        VALUES($1,$2,$3,'amtech',$4,$5,true,$6,$7,1,$8,$9,$10)
        ON CONFLICT(campaign_id,email) DO UPDATE SET display_name=EXCLUDED.display_name,access_enabled=EXCLUDED.access_enabled,permissions=EXCLUDED.permissions,access_revision=r2pl_v2.portal_admins.access_revision+1,
        password_hash=COALESCE(EXCLUDED.password_hash,r2pl_v2.portal_admins.password_hash),password_salt=COALESCE(EXCLUDED.password_salt,r2pl_v2.portal_admins.password_salt),test_profiles=EXCLUDED.test_profiles RETURNING *`,
          [
            this.campaign,
            `local-admin:${randomUUID()}`,
            randomUUID(),
            email,
            name,
            v.enabled,
            permissions,
            credentials?.encoded ?? null,
            credentials?.salt ?? null,
            testProfiles,
          ],
        )
      ).rows[0]!;
      if (testProfiles)
        await provisionTestProfiles(db, this.campaign, row.actor_id, name);
      await revokeTestPlay(db, this.campaign, row.actor_id);
      await db.query(
        "DELETE FROM r2pl_v2.portal_admin_sessions WHERE campaign_id=$1 AND actor_id=$2",
        [this.campaign, row.actor_id],
      );
      await db.query(
        "DELETE FROM r2pl_v2.portal_admin_launches WHERE campaign_id=$1 AND actor_id=$2",
        [this.campaign, row.actor_id],
      );
      await db.query(
        "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'admin-access',$3)",
        [
          this.campaign,
          actor,
          JSON.stringify({
            email,
            enabled: v.enabled,
            permissions,
            passwordReset: !!credentials,
            revision: row.access_revision,
            testProfiles,
          }),
        ],
      );
      return view(row);
    });
  }
  async login(
    emailInput: unknown,
    password: unknown,
    source: string,
  ): Promise<string> {
    const email = emailValue(emailInput),
      c = GAME_CONFIG.adminAccess;
    if (typeof password !== "string" || password.length > c.maxPasswordLength)
      throw new PortalError(401, "INVALID_CREDENTIALS");
    await this.locked(async (db) => {
      // Limits persist across process restarts and do not trust forwarded client IP headers.
      const expired = await db.query(
        "DELETE FROM r2pl_v2.admin_login_limits WHERE campaign_id=$1 AND started_at<clock_timestamp()-($2::text||' milliseconds')::interval",
        [this.campaign, c.loginWindowMs],
      );
      void expired;
      for (const [bucket, max] of [
        [`email:${email}`, c.maxEmailAttempts],
        [`source:${source}`, c.maxOriginAttempts],
      ] as const) {
        const row = (
          await db.query<{ attempts: number }>(
            `INSERT INTO r2pl_v2.admin_login_limits(campaign_id,bucket,attempts) VALUES($1,$2,1) ON CONFLICT(campaign_id,bucket) DO UPDATE SET attempts=r2pl_v2.admin_login_limits.attempts+1 RETURNING attempts`,
            [this.campaign, bucket],
          )
        ).rows[0]!;
        if (row.attempts > max)
          throw new PortalError(429, "LOGIN_RATE_LIMITED");
      }
    });
    const row = (
      await this.pool.query<AccessRow>(
        "SELECT * FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND email=$2",
        [this.campaign, email],
      )
    ).rows[0];
    const candidate = (await derive(
      password,
      row?.password_salt ?? Buffer.alloc(32),
      64,
    )) as Buffer;
    if (
      !row?.password_hash ||
      !timingSafeEqual(candidate, row.password_hash) ||
      (!row.protected_root && (!row.active || !row.access_enabled))
    )
      throw new PortalError(401, "INVALID_CREDENTIALS");
    return this.locked(async (db) => {
      const live = (
        await db.query<AccessRow>(
          "SELECT * FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND actor_id=$2 FOR UPDATE",
          [this.campaign, row.actor_id],
        )
      ).rows[0];
      if (
        !live?.password_hash?.equals(row.password_hash!) ||
        (!live.protected_root && (!live.active || !live.access_enabled))
      )
        throw new PortalError(401, "INVALID_CREDENTIALS");
      const token = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO r2pl_v2.portal_admin_sessions(campaign_id,token_hash,actor_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::text||' milliseconds')::interval)",
        [
          this.campaign,
          hash(token),
          row.actor_id,
          GAME_CONFIG.integration.sessionTtlMs,
        ],
      );
      await db.query(
        "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'admin-login','{}')",
        [this.campaign, row.actor_id],
      );
      if (live.test_profiles)
        await bindTestProfile(db, this.campaign, row.actor_id, token);
      return token;
    });
  }
  /** Operator-only bootstrap. Never called by HTTP; existing root credentials are immutable here. */
  async provisionRoot(password: string): Promise<void> {
    const credentials = await passwordCredentials(password);
    await this.locked(async (db) => {
      const existing = (
        await db.query<AccessRow>(
          "SELECT * FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND email=$2 FOR UPDATE",
          [this.campaign, ROOT_ADMIN_EMAIL],
        )
      ).rows[0];
      if (existing?.protected_root) return;
      if (existing)
        throw new Error(
          "Root email already exists; operator must review its identity before bootstrap",
        );
      await db.query(
        `INSERT INTO r2pl_v2.portal_admins(campaign_id,external_student_id,actor_id,organization_id,email,display_name,active,protected_root,password_hash,password_salt) VALUES($1,$2,$3,'amtech',$4,'AMTECH Root',true,true,$5,$6)`,
        [
          this.campaign,
          `root-admin:${randomUUID()}`,
          randomUUID(),
          ROOT_ADMIN_EMAIL,
          credentials.encoded,
          credentials.salt,
        ],
      );
    });
  }
}

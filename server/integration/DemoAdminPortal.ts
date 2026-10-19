import { isAmtechIdentity } from "../../shared/integration/identity.ts";
import { validatePortalConfig, type PortalConfig } from "./PortalConfig.ts";
import { PortalError } from "./PortalSignature.ts";
import { PortalStore, portalObject } from "./PortalStore.ts";

/** Separate credentials, enabled only by the synthetic Demo and dummy Portal launchers. */
export function demoAdminConfigFromEnv(): PortalConfig | undefined {
  if (process.env.DEMO_ADMIN_ENABLED !== "1") return undefined;
  const config = validatePortalConfig({
    campaignId: process.env.DEMO_ADMIN_CAMPAIGN_ID ?? "",
    publicOrigin: process.env.DEMO_ADMIN_ORIGIN ?? "",
    portalLoginUrl: process.env.DEMO_ADMIN_PORTAL_LOGIN_URL ?? "",
    websocketUrl: process.env.DEMO_ADMIN_WEBSOCKET_URL ?? "",
    keys: {
      [process.env.DEMO_ADMIN_KEY_ID ?? ""]:
        process.env.DEMO_ADMIN_SECRET ?? "",
    },
    adminKey: process.env.DEMO_ADMIN_OPERATOR_KEY ?? "",
    mode: "staging",
  });
  if (
    config.campaignId !== "98000000-0000-4000-8000-000000000000" ||
    config.publicOrigin !== "https://play.skai0o0.id.vn" ||
    config.portalLoginUrl !== "https://portal.skai0o0.id.vn/login"
  )
    throw new Error(
      "Demo admin credentials are restricted to the synthetic Demo",
    );
  return config;
}

/** Reuse signed, one-use browser-bound handoff; never provision students or wallets. */
export class DemoAdminStore extends PortalStore {
  override async upsertMember(input: unknown): Promise<unknown> {
    const value = portalObject(input, [
      "externalStudentId",
      "schoolId",
      "displayName",
      "eduVerified",
      "active",
      "email",
      "emailVerified",
    ]);
    if (!isAmtechIdentity(value.email, value.emailVerified))
      throw new PortalError(403, "ADMIN_REQUIRED");
    return super.upsertMember(input);
  }
  override async launch(input: unknown): Promise<unknown> {
    const value = portalObject(input, ["externalStudentId", "codeChallenge"]);
    if (
      typeof value.externalStudentId !== "string" ||
      !(
        await this.pool.query(
          "SELECT 1 FROM r2pl_v2.portal_admins WHERE campaign_id=$1 AND external_student_id=$2 AND active",
          [this.config.campaignId, value.externalStudentId],
        )
      ).rowCount
    )
      throw new PortalError(403, "ADMIN_REQUIRED");
    return super.launch(input);
  }
  override async running(): Promise<never> {
    throw new PortalError(403, "ADMIN_CANNOT_PLAY");
  }
  override async account(): Promise<never> {
    throw new PortalError(403, "ADMIN_CANNOT_PLAY");
  }
  override async socketTicket(): Promise<never> {
    throw new PortalError(403, "ADMIN_CANNOT_PLAY");
  }
  override async exchange(input: unknown): ReturnType<PortalStore["exchange"]> {
    const session = await super.exchange(input);
    if (!(await this.authenticateAdmin(session.token))) {
      await this.logout(session.token);
      throw new PortalError(403, "ADMIN_REQUIRED");
    }
    return session;
  }
}

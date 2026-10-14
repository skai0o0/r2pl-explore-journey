import type { PoolClient } from "pg";
import { campaignWeekStart } from "../../shared/integration/running.ts";
import type {
  CampaignProvider,
  VerifiedCampaignIdentity,
} from "./CampaignProvider.ts";
import type { SchoolPlayActor } from "./SchoolPlayFixture.ts";
/** Transaction-bound local provider. Credentials resolve server-owned actor/school records. */
export class SyntheticCampaignProvider implements CampaignProvider {
  readonly providerId = "signed-staging";
  private db: PoolClient;
  private campaign: string;
  private actor: SchoolPlayActor;
  constructor(db: PoolClient, campaign: string, actor: SchoolPlayActor) {
    this.db = db;
    this.campaign = campaign;
    this.actor = actor;
  }
  async verifySession(credential: string): Promise<VerifiedCampaignIdentity> {
    if (credential !== this.actor.token) throw new Error("Unauthorized");
    return {
      provider: this.providerId,
      externalStudentId: this.actor.actorId,
      externalSchoolId: this.actor.schoolName,
      sessionExpiresAtMs: Date.now() + 3600000,
    };
  }
  async fetchRunningSnapshot(id: string): Promise<unknown> {
    if (id !== this.actor.actorId) throw new Error("Unauthorized");
    const now = Date.now();
    const row =
      (
        await this.db.query<{
          data: {
            meters?: number;
            week?: number;
            weeklyMeters?: number;
            revision?: number;
          };
        }>(
          "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='running' AND id=$2",
          [this.campaign, id],
        )
      ).rows[0]?.data ?? {};
    return {
      provider: this.providerId,
      externalStudentId: id,
      revision: String(row.revision ?? 1),
      cumulativeMeters: String(row.meters ?? 0),
      observedAtMs: now,
      weekStartMs: campaignWeekStart(now),
      weeklyMeters: String(
        row.week === campaignWeekStart(now) ? (row.weeklyMeters ?? 0) : 0,
      ),
    };
  }
  async addMeters(meters: number): Promise<void> {
    const now = Date.now(),
      week = campaignWeekStart(now);
    await this.db.query(
      `INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'running',$2,jsonb_build_object('meters',$3::bigint,'weeklyMeters',$3::bigint,'week',$4::bigint,'revision',1)) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=jsonb_build_object('meters',(game_state.data->>'meters')::bigint+$3::bigint,'weeklyMeters',CASE WHEN (game_state.data->>'week')::bigint=$4 THEN (game_state.data->>'weeklyMeters')::bigint+$3::bigint ELSE $3::bigint END,'week',$4::bigint,'revision',(game_state.data->>'revision')::bigint+1)`,
      [this.campaign, this.actor.actorId, meters, week],
    );
  }
}

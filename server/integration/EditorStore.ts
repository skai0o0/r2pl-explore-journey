import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  EDITOR_CONFIG,
  type EditorSnapshot,
  validateEditorLayout,
} from "../../shared/gameplay/editor.ts";
import type { WorldObject } from "../../shared/gameplay/gameConfig.ts";
import { PortalError } from "./PortalSignature.ts";
import { portalObject } from "./PortalStore.ts";

export class EditorStore {
  private pool: Pool;
  private campaignId: string;
  constructor(pool: Pool, campaignId: string) {
    this.pool = pool;
    this.campaignId = campaignId;
  }
  private async transaction<T>(
    actorId: string,
    token: string,
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.campaignId}`,
      ]);
      if (
        !(
          await db.query(
            "SELECT 1 FROM r2pl_v2.portal_admins a JOIN r2pl_v2.portal_admin_sessions s USING(campaign_id,actor_id) WHERE a.campaign_id=$1 AND a.actor_id=$2 AND a.active AND s.token_hash=$3 AND s.expires_at>clock_timestamp() FOR SHARE OF a,s",
            [
              this.campaignId,
              actorId,
              createHash("sha256").update(token).digest(),
            ],
          )
        ).rowCount
      )
        throw new PortalError(403, "ADMIN_REQUIRED");
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
  async snapshot(actorId: string, token: string): Promise<EditorSnapshot> {
    return this.transaction(actorId, token, async (db) => {
      const objects = (
        await db.query<{ data: WorldObject }>(
          "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 ORDER BY id",
          [this.campaignId],
        )
      ).rows.map((r) => r.data);
      const revision = (
        await db.query<{ revision: number }>(
          "SELECT COALESCE(max(revision),0)::integer AS revision FROM r2pl_v2.editor_versions WHERE campaign_id=$1",
          [this.campaignId],
        )
      ).rows[0]!.revision;
      const draft = (
        await db.query<{
          objects: WorldObject[];
          revision: number;
          base_revision: number;
        }>(
          "SELECT objects,revision,base_revision FROM r2pl_v2.editor_drafts WHERE campaign_id=$1 AND actor_id=$2",
          [this.campaignId, actorId],
        )
      ).rows[0];
      const history = (
        await db.query<{ revision: number; actor: string; createdAt: string }>(
          `SELECT v.revision,COALESCE(a.display_name,'Bố cục ban đầu') AS actor,v.created_at::text AS "createdAt" FROM r2pl_v2.editor_versions v LEFT JOIN r2pl_v2.portal_admins a ON a.campaign_id=v.campaign_id AND a.actor_id=v.actor_id WHERE v.campaign_id=$1 ORDER BY v.revision DESC LIMIT $2`,
          [this.campaignId, EDITOR_CONFIG.maxHistory],
        )
      ).rows;
      return {
        objects,
        revision,
        draft: draft
          ? {
              objects: draft.objects,
              revision: draft.revision,
              baseRevision: draft.base_revision,
            }
          : null,
        history,
      };
    });
  }
  async save(
    actorId: string,
    input: unknown,
    token: string,
  ): Promise<{ revision: number }> {
    const value = portalObject(input, [
      "objects",
      "baseRevision",
      "draftRevision",
    ]);
    validateEditorLayout(value.objects);
    if (
      !Number.isSafeInteger(value.baseRevision) ||
      Number(value.baseRevision) < 0 ||
      !Number.isSafeInteger(value.draftRevision) ||
      Number(value.draftRevision) < 0
    )
      throw new TypeError("Invalid draft version");
    return this.transaction(actorId, token, async (db) => {
      const live = (
        await db.query<{ revision: number }>(
          "SELECT COALESCE(max(revision),0)::integer AS revision FROM r2pl_v2.editor_versions WHERE campaign_id=$1",
          [this.campaignId],
        )
      ).rows[0]!.revision;
      if (Number(value.baseRevision) > live)
        throw new TypeError("Invalid base version");
      const old = (
        await db.query<{ revision: number }>(
          "SELECT revision FROM r2pl_v2.editor_drafts WHERE campaign_id=$1 AND actor_id=$2 FOR UPDATE",
          [this.campaignId, actorId],
        )
      ).rows[0];
      if ((old?.revision ?? 0) !== value.draftRevision)
        throw new PortalError(409, "DRAFT_VERSION_CONFLICT");
      const revision = (old?.revision ?? 0) + 1;
      await db.query(
        "INSERT INTO r2pl_v2.editor_drafts(campaign_id,actor_id,revision,base_revision,objects) VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_id,actor_id) DO UPDATE SET revision=EXCLUDED.revision,base_revision=EXCLUDED.base_revision,objects=EXCLUDED.objects,updated_at=clock_timestamp()",
        [
          this.campaignId,
          actorId,
          revision,
          value.baseRevision,
          JSON.stringify(value.objects),
        ],
      );
      return { revision };
    });
  }
}

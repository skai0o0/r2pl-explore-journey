import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { IdempotencyConflict } from "../persistence/M3TestMutation.ts";
import type { QaFixtureV1 } from "../qa/KnowledgeQaGatewayV1.ts";

export interface ExploreReceiptV1 {
  kind: "apply" | "reject";
  reason: "owned" | "unavailable";
  spentPoints: "1" | "0";
  tileIndex: number | null;
}

/** Synthetic selected-tile topology; constructed only after the gateway's QA guards. */
export class KnowledgeExploreQaV1 {
  private readonly pool: Pool;
  private readonly campaignId: string;
  private readonly fixtures: readonly QaFixtureV1[];
  constructor(
    pool: Pool,
    campaignId: string,
    fixtures: readonly QaFixtureV1[],
  ) {
    this.pool = pool;
    this.campaignId = campaignId;
    this.fixtures = fixtures;
  }

  async execute(
    fixture: QaFixtureV1,
    commandId: string,
    tileIndex = 999999,
  ): Promise<ExploreReceiptV1> {
    if (
      !this.fixtures.includes(fixture) ||
      typeof commandId !== "string" ||
      !Number.isInteger(tileIndex) ||
      tileIndex < 0 ||
      tileIndex > 999999 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        commandId,
      )
    )
      throw new Error("Invalid verified QA command");
    const key = Buffer.from(commandId.replaceAll("-", ""), "hex");
    const hash = createHash("sha256")
      .update(`knowledge-explore-qa-v1:${fixture.schoolSlot}:${tileIndex}:1`)
      .digest();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize selected-tile claims and retries across all server instances.
      await client.query("SELECT id FROM campaigns WHERE id=$1 FOR UPDATE", [
        this.campaignId,
      ]);
      const prior = await client.query<{
        payload_hash: Buffer;
        result: ExploreReceiptV1;
      }>(
        "SELECT payload_hash,result FROM command_results WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [this.campaignId, fixture.actorId, key],
      );
      if (prior.rows[0]) {
        if (!prior.rows[0].payload_hash.equals(hash))
          throw new IdempotencyConflict();
        await client.query("COMMIT");
        return prior.rows[0].result;
      }
      await client.query(
        "INSERT INTO command_results(campaign_id,actor_id,command_key,payload_hash,status) VALUES($1,$2,$3,$4,'processing')",
        [this.campaignId, fixture.actorId, key, hash],
      );
      const occupied = await client.query(
        "SELECT 1 FROM knowledge_ownership_tiles_v1 WHERE campaign_id=$1 AND tile_index=$2 UNION ALL SELECT 1 FROM knowledge_cases_v1 c, jsonb_array_elements(c.snapshot->'tiles') t WHERE c.campaign_id=$1 AND (t->>'tileIndex')::integer=$2",
        [this.campaignId, tileIndex],
      );
      let result: ExploreReceiptV1 = {
        kind: "reject",
        reason: "unavailable",
        spentPoints: "0",
        tileIndex: null,
      };
      if (!occupied.rowCount) {
        const debit = await client.query(
          "UPDATE wallet_accounts SET balance=balance-1 WHERE campaign_id=$1 AND actor_id=$2 AND resource='points' AND balance>=1 RETURNING balance",
          [this.campaignId, fixture.actorId],
        );
        if (debit.rowCount) {
          await client.query(
            "INSERT INTO knowledge_ownership_tiles_v1(campaign_id,tile_index,active_school_mask,case_id,case_revision,explore_actor_id,explore_command_key) VALUES($1,$2,$3,NULL,0,$4,$5)",
            [
              this.campaignId,
              tileIndex,
              1 << fixture.schoolSlot,
              fixture.actorId,
              key,
            ],
          );
          await client.query(
            "INSERT INTO knowledge_school_scores_v1(campaign_id,school_slot,active_tiles,revision) VALUES($1,$2,1,1) ON CONFLICT(campaign_id,school_slot) DO UPDATE SET active_tiles=knowledge_school_scores_v1.active_tiles+1,revision=knowledge_school_scores_v1.revision+1,reached_at=clock_timestamp()",
            [this.campaignId, fixture.schoolSlot],
          );
          await client.query(
            "INSERT INTO ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'points',-1)",
            [this.campaignId, fixture.actorId, key],
          );
          await client.query(
            "INSERT INTO knowledge_explore_outbox_qa_v1(campaign_id,actor_id,command_key,school_slot,tile_index) VALUES($1,$2,$3,$4,$5)",
            [
              this.campaignId,
              fixture.actorId,
              key,
              fixture.schoolSlot,
              tileIndex,
            ],
          );
          result = {
            kind: "apply",
            reason: "owned",
            spentPoints: "1",
            tileIndex,
          };
        }
      }
      await client.query(
        "UPDATE command_results SET status=$4,result=$5 WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [
          this.campaignId,
          fixture.actorId,
          key,
          result.kind === "apply" ? "test_applied" : "rejected",
          result,
        ],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

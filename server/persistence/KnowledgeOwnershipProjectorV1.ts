/** Private DEVELOPMENT projection; never a gameplay endpoint or public relay.
 * TODO(M3): approved versioned world codec integration, Shared baseline import and
 * cross-case handoff. Missing tiles start at the case's committed revision-1
 * departure outcome, NOT historical explorer ownership. Existing different-case
 * tiles fail closed until an authoritative handoff contract exists.
 * Scores cover ONLY this projection, not the entire unimported M3 world.
 * Network delivery is separate: use projectKnowledgeEvent in
 * server/realtime/KnowledgeVisibilityV1.ts per verified viewer, with its own
 * replay/delivery tracking. Never forward financial effect JSON to OutboxRelay.
 */
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import {
  type ClaimingKnowledge,
  HARD_CLAIM_MS,
  KNOWLEDGE_RULES_V1,
  type KnowledgeEffect,
  type KnowledgeState,
  ROLLING_FADE_MS,
  startKnowledgeContest,
  transitionKnowledge,
} from "../../shared/gameplay/knowledgeRulesV1.ts";
import {
  CommittedResultInterrupted,
  type FaultHooks,
} from "./M3TestMutation.ts";

const bigintFields = new Set([
  "openedAtMs",
  "t0Ms",
  "requiredPoints",
  "receivedPoints",
  "rollingDeadlineMs",
  "hardDeadlineMs",
  "requestedPoints",
  "acceptedPoints",
  "acceptedAtMs",
]);
function wire(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
interface FrozenSnapshot {
  readonly ruleVersion: string;
  readonly ruleParameters: unknown;
  readonly contestId: string;
  readonly schoolSlots: readonly [number, number];
  readonly tiles: ClaimingKnowledge["tiles"];
  readonly departingSchoolSlot: number;
}

/** Rebuild immutable proposals rather than accepting arbitrary tile writes.
 * Current store supports only open/contribute/expire. Unsupported histories fail
 * closed. Full JSON equality rejects extra/duplicate/omitted ownership effects
 * and altered financial effects, even though this projector does no wallet I/O.
 */
export function validateKnowledgeProjectionEffectsV1(input: {
  readonly campaignId: string;
  readonly snapshot: unknown;
  readonly state: unknown;
  readonly revision: number;
  readonly effects: unknown;
}): readonly Extract<KnowledgeEffect, { kind: "ownership" }>[] {
  const snapshot = input.snapshot as FrozenSnapshot;
  const state = JSON.parse(
    JSON.stringify(input.state),
    (key, value: unknown) =>
      bigintFields.has(key) ? BigInt(value as string) : value,
  ) as
    | ClaimingKnowledge
    | Extract<KnowledgeState, { phase: "success" | "failure" }>;
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    snapshot.ruleVersion !== KNOWLEDGE_RULES_V1 ||
    !isDeepStrictEqual(snapshot.ruleParameters, {
      rollingFadeMs: ROLLING_FADE_MS.toString(),
      hardClaimMs: HARD_CLAIM_MS.toString(),
      fee: "ceil(eligibleTileCount/2)",
    }) ||
    !["claiming", "success", "failure"].includes(state.phase)
  )
    throw new Error("Unsupported knowledge projection history");
  const shared = startKnowledgeContest({
    campaignId: input.campaignId,
    contestId: snapshot.contestId,
    schoolSlots: snapshot.schoolSlots,
    tiles: snapshot.tiles,
    openedAtMs: state.openedAtMs,
  });
  let transition = transitionKnowledge(shared, {
    kind: "departure",
    schoolSlot: snapshot.departingSchoolSlot,
    remainingSchoolValid: true,
    atMs: state.t0Ms,
  });
  if (transition.state.phase !== "claiming")
    throw new Error("Expected payable succession");
  let selected = input.revision === 1 ? transition.effects : undefined;
  for (const contribution of state.contributions) {
    transition = transitionKnowledge(transition.state, {
      kind: "contribute",
      ...contribution,
      verified: true,
      walletBalance: contribution.acceptedPoints,
      atMs: contribution.acceptedAtMs,
    });
    if (transition.kind !== "apply")
      throw new Error("Invalid contribution replay");
    if (transition.state.revision === input.revision)
      selected = transition.effects;
  }
  if (state.phase === "failure") {
    transition = transitionKnowledge(transition.state, {
      kind: "expire",
      atMs:
        state.rollingDeadlineMs < state.hardDeadlineMs
          ? state.rollingDeadlineMs
          : state.hardDeadlineMs,
    });
    if (transition.state.revision === input.revision)
      selected = transition.effects;
  }
  if (
    !isDeepStrictEqual(wire(transition.state), input.state) ||
    !selected ||
    !isDeepStrictEqual(wire(selected), input.effects)
  )
    throw new Error("Knowledge effects do not match immutable history");
  return selected.filter((effect) => effect.kind === "ownership");
}

export class KnowledgeOwnershipProjectorV1 {
  readonly #pool: Pool;
  constructor(pool: Pool, options: { readonly developmentOnly: true }) {
    if (options.developmentOnly !== true) throw new Error("Development only");
    this.#pool = pool;
  }

  /** One event per transaction; true means committed private projection ACK.
   * Case lock prevents workers overtaking revisions, even with SKIP LOCKED.
   * Sorted score and tile locks prevent deadlocks across overlapping cases.
   */
  async projectNext(
    campaignId: string,
    hooks: FaultHooks = {},
  ): Promise<boolean> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        campaignId,
      )
    )
      throw new Error("Expected canonical campaign UUID");
    const client = await this.#pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path=r2pl_v2,pg_catalog");
      const cases = await client.query<{
        case_id: string;
        snapshot: unknown;
        state: unknown;
      }>(
        `SELECT c.case_id,c.snapshot,c.state FROM knowledge_cases_v1 c
         WHERE c.campaign_id=$1 AND EXISTS (
          SELECT 1 FROM knowledge_effect_outbox_v1 o
          WHERE o.campaign_id=c.campaign_id AND o.case_id=c.case_id AND NOT EXISTS (
           SELECT 1 FROM knowledge_projection_acks_v1 a
           WHERE (a.campaign_id,a.case_id,a.revision)=(o.campaign_id,o.case_id,o.revision)))
         ORDER BY c.case_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,
        [campaignId],
      );
      const row = cases.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return false;
      }
      const pending = await client.query<{
        revision: string;
        effects: unknown;
      }>(
        `SELECT o.revision,o.effects FROM knowledge_effect_outbox_v1 o
         WHERE o.campaign_id=$1 AND o.case_id=$2 AND NOT EXISTS (
          SELECT 1 FROM knowledge_projection_acks_v1 a
          WHERE (a.campaign_id,a.case_id,a.revision)=(o.campaign_id,o.case_id,o.revision))
         ORDER BY o.revision LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
        [campaignId, row.case_id],
      );
      const event = pending.rows[0];
      if (!event) throw new Error("Pending knowledge effect unavailable");
      const prior = await client.query<{ revision: string }>(
        "SELECT coalesce(max(revision),0)::text AS revision FROM knowledge_projection_acks_v1 WHERE campaign_id=$1 AND case_id=$2",
        [campaignId, row.case_id],
      );
      if (BigInt(event.revision) !== BigInt(prior.rows[0]!.revision) + 1n)
        throw new Error("Knowledge projection revision gap");
      const effects = validateKnowledgeProjectionEffectsV1({
        campaignId,
        snapshot: row.snapshot,
        state: row.state,
        revision: Number(event.revision),
        effects: event.effects,
      });
      if (effects.length > 0) {
        // All 16 generic slots, no production roster inference. Ordered inserts
        // and locks also serialize aggregate changes across different cases.
        for (let slot = 0; slot < 16; slot++) {
          await client.query(
            "INSERT INTO knowledge_school_scores_v1(campaign_id,school_slot) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [campaignId, slot],
          );
        }
        await client.query(
          "SELECT school_slot FROM knowledge_school_scores_v1 WHERE campaign_id=$1 ORDER BY school_slot FOR UPDATE",
          [campaignId],
        );
        const deltas = Array<bigint>(16).fill(0n);
        for (const effect of [...effects].sort(
          (a, b) => a.tileIndex - b.tileIndex,
        )) {
          const tiles = await client.query<{
            active_school_mask: number;
            case_id: string;
            case_revision: string;
          }>(
            "SELECT active_school_mask,case_id,case_revision FROM knowledge_ownership_tiles_v1 WHERE campaign_id=$1 AND tile_index=$2 FOR UPDATE",
            [campaignId, effect.tileIndex],
          );
          const tile = tiles.rows[0];
          if (
            tile &&
            (tile.case_id !== row.case_id ||
              BigInt(tile.case_revision) >= BigInt(event.revision))
          )
            throw new Error(
              "Ownership requires authoritative cross-case handoff",
            );
          if (!tile && event.revision !== "1")
            throw new Error("Missing ownership baseline");
          if (tile?.case_revision === "0") {
            const schools = (row.snapshot as FrozenSnapshot).schoolSlots;
            if (
              event.revision !== "1" ||
              tile.active_school_mask !==
                ((1 << schools[0]) | (1 << schools[1]))
            )
              throw new Error("Invalid Shared ownership baseline");
          }
          const oldMask = tile?.active_school_mask ?? 0;
          const newMask =
            effect.ownerSchoolSlot === null ? 0 : 1 << effect.ownerSchoolSlot;
          for (let slot = 0; slot < 16; slot++) {
            deltas[slot] =
              deltas[slot]! +
              BigInt(((newMask >> slot) & 1) - ((oldMask >> slot) & 1));
          }
          await client.query(
            `INSERT INTO knowledge_ownership_tiles_v1(campaign_id,tile_index,active_school_mask,case_id,case_revision)
             VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_id,tile_index) DO UPDATE
             SET active_school_mask=excluded.active_school_mask,case_revision=excluded.case_revision`,
            [
              campaignId,
              effect.tileIndex,
              newMask,
              row.case_id,
              event.revision,
            ],
          );
        }
        for (let slot = 0; slot < 16; slot++) {
          if (deltas[slot] === 0n) continue;
          await client.query(
            `UPDATE knowledge_school_scores_v1 SET active_tiles=active_tiles+$3,
             revision=revision+1,reached_at=clock_timestamp() WHERE campaign_id=$1 AND school_slot=$2`,
            [campaignId, slot, deltas[slot]!.toString()],
          );
        }
      }
      await client.query(
        "INSERT INTO knowledge_projection_acks_v1(campaign_id,case_id,revision) VALUES($1,$2,$3)",
        [campaignId, row.case_id, event.revision],
      );
      hooks.beforeCommit?.();
      await client.query("COMMIT");
      committed = true;
      hooks.afterCommit?.();
      return true;
    } catch (error) {
      if (committed)
        throw new CommittedResultInterrupted(
          "Private projection committed; retry queue",
        );
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Pool, PoolClient } from "pg";
import type { EvaluateDevExplore } from "../../shared/gameplay/devContract.ts";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  decodeFogChunk,
  decodeKnowledgeChunk,
} from "../../shared/world/codec.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  WORLD_FORMAT_VERSION,
} from "../../shared/world/constants.ts";
import {
  assertTileIndex,
  chunkCoordinatesForId,
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { schoolBit } from "../../shared/world/registry.ts";
import { adjustKnowledgeScore } from "../integration/KnowledgeScore.ts";
import {
  clusters,
  joinShared,
  settleShared,
} from "../integration/SharedKnowledge.ts";

import {
  checkExploreBoundary,
  type ExploreBoundary,
  lockExploreNeighborhood,
} from "./ExploreBoundary.ts";

export type WriteStrategy = "full_chunk" | "mutation_log";
export interface M3TestCommand {
  readonly campaignId: string;
  readonly actorId: string;
  readonly schoolSlot: number; // trusted fixture identity, never client supplied
  readonly key: Uint8Array;
  readonly tileIndex: number;
  readonly intent?: "explore" | "study";
  readonly cost: bigint; // explicit fixture amount, never a gameplay default
}
export interface M3TestResult {
  readonly status: "test_applied" | "test_no_change" | "rejected";
  readonly reason:
    | "none"
    | "insufficient_fixture_credit"
    | "not_adjacent"
    | "protected_hq"
    | "shared_full"
    | "wrong_action";
  readonly chunkId: number;
  readonly revision: string;
  readonly balance: string;
  readonly viewRevision?: string; // M3.5 synthetic per-school projection only
}
export interface MutationMetrics {
  readonly transactionMs: number;
  readonly poolWaitMs: number;
  readonly poolAcquiredAtMonotonicMs: number;
  readonly dbTransactionMs: number;
  readonly committedAtMs: number;
  readonly committedAtMonotonicMs: number;
  readonly headLockWaitMs: number;
  readonly worldReadMs: number;
  readonly worldWriteMs: number;
  readonly committed: boolean;
  readonly replayed: boolean;
}
export interface ApplyOutcome {
  readonly result: M3TestResult;
  readonly metrics: MutationMetrics;
  readonly outboxId?: string;
}
export interface FaultHooks {
  readonly beforeCommit?: () => void;
  readonly afterCommit?: () => void;
}
export class IdempotencyConflict extends Error {}
export class CommittedResultInterrupted extends Error {}

const ZERO_MASK = Buffer.alloc(CHUNK_MASK_BYTES);
const ZERO_FOG = Buffer.alloc(CHUNK_FOG_BYTES);
const ZERO_MASK_CRC = crc32(ZERO_MASK);
const ZERO_FOG_CRC = crc32(ZERO_FOG);

function payloadHash(command: M3TestCommand): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.write("M3T1", 0, "ascii");
  bytes.writeUInt32LE(command.tileIndex, 8);
  bytes.writeUInt8(command.schoolSlot, 12);
  bytes.writeUInt8(
    command.intent === "study" ? 2 : command.intent === "explore" ? 1 : 0,
    13,
  );
  bytes.writeBigUInt64LE(command.cost, 16);
  return createHash("sha256").update(bytes).digest();
}

function maskAt(mask: Buffer, local: number): number {
  return mask.readUInt16LE(local * 2);
}
function revealed(fog: Buffer, local: number): boolean {
  return !!(fog[local >> 3]! & (1 << (local & 7)));
}
function assertPayload(mask: Buffer, fog: Buffer): void {
  if (mask.length !== CHUNK_MASK_BYTES || fog.length !== CHUNK_FOG_BYTES)
    throw new Error("Corrupt world materialization length");
}

interface ChunkView {
  readonly mask: Buffer;
  readonly fog: Buffer;
  readonly revision: bigint;
}

/** Reconstructs authoritative state from checkpoint plus ordered durable mutations. */
export async function readAuthoritativeChunk(
  client: PoolClient,
  campaignId: string,
  id: number,
  slot: number,
): Promise<ChunkView> {
  const head = await client.query<{ revision: string }>(
    "SELECT revision FROM world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2",
    [campaignId, id],
  );
  if (!head.rows[0]) throw new Error("Missing chunk head");
  const checkpoint = await client.query<{
    revision: string;
    mask: Buffer;
    mask_crc: string;
  }>(
    "SELECT revision, mask, mask_crc FROM world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
    [campaignId, id],
  );
  const fogCheckpoint = await client.query<{
    revision: string;
    fog: Buffer;
    fog_crc: string;
  }>(
    "SELECT revision, fog, fog_crc FROM school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
    [campaignId, id, slot],
  );
  if (!checkpoint.rows[0] || !fogCheckpoint.rows[0])
    throw new Error("Missing world checkpoint");
  const mask = Buffer.from(checkpoint.rows[0].mask);
  const fog = Buffer.from(fogCheckpoint.rows[0].fog);
  assertPayload(mask, fog);
  const revision = BigInt(head.rows[0].revision);
  const base = BigInt(checkpoint.rows[0].revision);
  const fogRevision = BigInt(fogCheckpoint.rows[0].revision);
  if (base > revision || fogRevision > base)
    throw new Error("Checkpoint ahead of head");
  const { chunkX, chunkZ } = chunkCoordinatesForId(id);
  decodeKnowledgeChunk({
    formatVersion: WORLD_FORMAT_VERSION,
    chunkX,
    chunkZ,
    revision: base,
    checksum: Number(checkpoint.rows[0].mask_crc),
    payload: mask,
  });
  decodeFogChunk({
    formatVersion: WORLD_FORMAT_VERSION,
    chunkX,
    chunkZ,
    schoolSlot: slot,
    revision: fogRevision,
    checksum: Number(fogCheckpoint.rows[0].fog_crc),
    payload: fog,
  });
  if (base < revision) {
    const mutations = await client.query<{
      revision: string;
      local_index: number;
      school_slot: number;
      new_mask: number;
      discovered: boolean;
    }>(
      "SELECT revision, local_index, school_slot, new_mask, discovered FROM world_mutations WHERE campaign_id=$1 AND chunk_id=$2 AND revision>$3 ORDER BY revision",
      [campaignId, id, base.toString()],
    );
    let expected = base;
    for (const row of mutations.rows) {
      if (BigInt(row.revision) !== ++expected)
        throw new Error("World mutation revision gap");
      mask.writeUInt16LE(row.new_mask, row.local_index * 2);
      if (row.school_slot === slot && row.discovered)
        fog[row.local_index >> 3]! |= 1 << (row.local_index & 7);
    }
    if (expected !== revision)
      throw new Error("World mutation replay incomplete");
  }
  return { mask, fog, revision };
}

/** M3 fixture-only transaction. This is not connected to the M2 production opcode. */
export class M3TestMutationService {
  readonly #pool: Pool;
  readonly #realtimeViews: boolean;
  readonly #devExplore: EvaluateDevExplore | undefined;
  readonly #boundary: ExploreBoundary | undefined;
  constructor(
    pool: Pool,
    options: {
      readonly realtimeViews?: boolean;
      readonly devExplore?: EvaluateDevExplore;
      readonly boundary?: ExploreBoundary;
    } = {},
  ) {
    this.#pool = pool;
    this.#realtimeViews = options.realtimeViews ?? false;
    this.#devExplore = options.devExplore;
    this.#boundary = options.boundary;
  }

  async apply(
    command: M3TestCommand,
    hooks: FaultHooks = {},
  ): Promise<ApplyOutcome> {
    assertTileIndex(command.tileIndex);
    schoolBit(command.schoolSlot);
    if (
      command.key.length !== 16 ||
      command.cost < 0n ||
      command.cost > 0x7fffffffffffffffn ||
      (command.intent !== undefined &&
        !["explore", "study"].includes(command.intent))
    )
      throw new RangeError("Invalid M3 fixture command");
    const { x, z } = tileCoordinates(command.tileIndex);
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(command.tileIndex);
    const id = chunkId(chunkX, chunkZ);
    const local = localIndex(x, z);
    const digest = payloadHash(command);
    const start = performance.now();
    let worldReadMs = 0;
    let worldWriteMs = 0;
    let headLockWaitMs = 0;
    const client = await this.#pool.connect();
    const poolWaitMs = performance.now() - start;
    const poolAcquiredAtMonotonicMs = Number(process.hrtime.bigint()) / 1e6;
    const dbStarted = performance.now();
    let committed = false;
    let replayed = false;
    let outboxId: string | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = r2pl_v2, pg_catalog");
      await client.query("SET LOCAL synchronous_commit = on");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const claim = await client.query(
        "INSERT INTO command_results(campaign_id,actor_id,command_key,payload_hash,status) VALUES($1,$2,$3,$4,'processing') ON CONFLICT DO NOTHING RETURNING status",
        [command.campaignId, command.actorId, Buffer.from(command.key), digest],
      );
      if (claim.rowCount === 0) {
        const existing = await client.query<{
          payload_hash: Buffer;
          status: string;
          result: M3TestResult | null;
        }>(
          "SELECT payload_hash,status,result FROM command_results WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3 FOR UPDATE",
          [command.campaignId, command.actorId, Buffer.from(command.key)],
        );
        const row = existing.rows[0];
        if (!row?.payload_hash.equals(digest))
          throw new IdempotencyConflict(
            "Command key reused with different payload",
          );
        if (row.status === "processing" || !row.result)
          throw new Error("Incomplete committed command result");
        await client.query("COMMIT");
        const committedAtMs = performance.now();
        const committedAtMonotonicMs = Number(process.hrtime.bigint()) / 1e6;
        committed = true;
        replayed = true;
        return {
          result: row.result,
          metrics: {
            transactionMs: performance.now() - start,
            poolWaitMs,
            poolAcquiredAtMonotonicMs,
            dbTransactionMs: committedAtMs - dbStarted,
            committedAtMs,
            committedAtMonotonicMs,
            headLockWaitMs,
            worldReadMs,
            worldWriteMs,
            committed,
            replayed,
          },
        };
      }
      const campaign = await client.query<{ write_strategy: WriteStrategy }>(
        "SELECT write_strategy FROM campaigns WHERE id=$1",
        [command.campaignId],
      );
      if (!campaign.rows[0]) throw new Error("Unknown campaign");
      if (
        this.#realtimeViews &&
        campaign.rows[0].write_strategy !== "full_chunk"
      )
        throw new Error("M3.5 realtime views require full-chunk persistence");
      const school = await client.query(
        "SELECT 1 FROM campaign_schools WHERE campaign_id=$1 AND slot=$2",
        [command.campaignId, command.schoolSlot],
      );
      if (school.rowCount !== 1) throw new Error("School slot not registered");
      if (this.#boundary?.ruleVersion === 1)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`signed-game:${command.campaignId}`],
        );
      if (this.#boundary) {
        if (campaign.rows[0].write_strategy !== "full_chunk")
          throw new Error("Expansion requires full-chunk persistence");
        await lockExploreNeighborhood(
          client,
          command.campaignId,
          command.tileIndex,
          this.#boundary.ruleVersion === 1
            ? GAME_CONFIG.world.fogRevealRadius
            : 0,
        );
      }
      if (this.#boundary?.ruleVersion === 1)
        await settleShared(
          client,
          command.campaignId,
          command.actorId,
          Date.now(),
        );
      const createdHead = await client.query(
        "INSERT INTO world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING chunk_id",
        [command.campaignId, id],
      );
      if (createdHead.rowCount === 1)
        await client.query(
          "INSERT INTO world_chunks(campaign_id,chunk_id,mask,mask_crc) VALUES($1,$2,$3,$4)",
          [command.campaignId, id, ZERO_MASK, ZERO_MASK_CRC],
        );
      await client.query(
        "INSERT INTO school_fog_chunks(campaign_id,chunk_id,school_slot,fog,fog_crc) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [command.campaignId, id, command.schoolSlot, ZERO_FOG, ZERO_FOG_CRC],
      );
      const lockStart = performance.now();
      await client.query(
        "SELECT revision FROM world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
        [command.campaignId, id],
      );
      headLockWaitMs = performance.now() - lockStart;
      const readStart = performance.now();
      const chunk = await readAuthoritativeChunk(
        client,
        command.campaignId,
        id,
        command.schoolSlot,
      );
      worldReadMs = performance.now() - readStart;
      let viewRevision = 0n;
      if (this.#realtimeViews) {
        await client.query(
          "INSERT INTO school_chunk_views(campaign_id,chunk_id,school_slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [command.campaignId, id, command.schoolSlot],
        );
        const view = await client.query<{ view_revision: string }>(
          "SELECT view_revision FROM school_chunk_views WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3 FOR UPDATE",
          [command.campaignId, id, command.schoolSlot],
        );
        if (!view.rows[0]) throw new Error("Missing school view revision");
        viewRevision = BigInt(view.rows[0].view_revision);
      }
      const knownBySchool =
        (maskAt(chunk.mask, local) & schoolBit(command.schoolSlot)) !== 0;
      const discoveredBySchool = revealed(chunk.fog, local);
      const alreadyExplored =
        knownBySchool &&
        (this.#boundary?.ruleVersion === 1 || discoveredBySchool);
      const originalMask = maskAt(chunk.mask, local);
      const holders = Array.from({ length: 16 }, (_, slot) => slot).filter(
        (slot) => originalMask & (1 << slot),
      );
      const effectiveCost =
        this.#boundary?.ruleVersion === 1
          ? BigInt(
              holders.length
                ? GAME_CONFIG.knowledge.sharedPoints
                : GAME_CONFIG.knowledge.explorePoints,
            )
          : command.cost;
      let devDecision: ReturnType<EvaluateDevExplore> | undefined;
      if (this.#devExplore) {
        const lockedWallet = await client.query<{ balance: string }>(
          "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit' FOR UPDATE",
          [command.campaignId, command.actorId],
        );
        const lockedBalance = BigInt(lockedWallet.rows[0]?.balance ?? "0");
        devDecision = this.#devExplore(
          {
            tileIndex: command.tileIndex,
            schoolSlot: command.schoolSlot,
            knownBySchool,
            discoveredBySchool,
            balance: lockedBalance,
          },
          {
            ruleVersion: 0,
            resource: "fixture-credit",
            cost: command.cost,
          },
        );
        if (
          (alreadyExplored && devDecision.kind !== "no_change") ||
          (!alreadyExplored && devDecision.kind === "no_change") ||
          (devDecision.kind === "apply" &&
            (devDecision.debit !== command.cost ||
              lockedBalance < command.cost)) ||
          (devDecision.kind === "reject" && lockedBalance >= command.cost)
        )
          throw new Error(
            "Development rule disagrees with durable fixture contract",
          );
      }
      const pendingConsolidation =
        this.#boundary?.ruleVersion === 1 &&
        !knownBySchool &&
        (await clusters(client, command.campaignId)).some(
          (c) =>
            c.status === "consolidating" &&
            c.tiles.some((t) => t.tile === command.tileIndex),
        );
      const spatialRejection =
        this.#boundary?.ruleVersion === 1 &&
        !knownBySchool &&
        ((command.intent === "explore" && holders.length > 0) ||
          (command.intent === "study" && holders.length === 0))
          ? "wrong_action"
          : pendingConsolidation ||
              (this.#boundary?.ruleVersion === 1 &&
                !knownBySchool &&
                holders.length >= GAME_CONFIG.knowledge.maxSchools)
            ? "shared_full"
            : this.#boundary && !alreadyExplored
              ? await checkExploreBoundary(
                  client,
                  command.campaignId,
                  command.schoolSlot,
                  command.tileIndex,
                  this.#boundary,
                )
              : undefined;
      let result: M3TestResult;
      if (alreadyExplored) {
        const wallet = await client.query<{ balance: string }>(
          "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
          [command.campaignId, command.actorId],
        );
        result = {
          status: "test_no_change",
          reason: "none",
          chunkId: id,
          revision: chunk.revision.toString(),
          balance: wallet.rows[0]?.balance ?? "0",
          ...(this.#realtimeViews
            ? { viewRevision: viewRevision.toString() }
            : {}),
        };
      } else {
        const wallet =
          spatialRejection || devDecision?.kind === "reject"
            ? { rows: [] as { balance: string }[] }
            : await client.query<{ balance: string }>(
                "UPDATE wallet_accounts SET balance=balance-$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit' AND balance >= $3 RETURNING balance",
                [command.campaignId, command.actorId, effectiveCost.toString()],
              );
        if (!wallet.rows[0]) {
          const current = await client.query<{ balance: string }>(
            "SELECT balance FROM wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
            [command.campaignId, command.actorId],
          );
          result = {
            status: "rejected",
            reason: spatialRejection ?? "insufficient_fixture_credit",
            chunkId: id,
            revision: chunk.revision.toString(),
            balance: current.rows[0]?.balance ?? "0",
            ...(this.#realtimeViews
              ? { viewRevision: viewRevision.toString() }
              : {}),
          };
        } else {
          if (this.#boundary?.ruleVersion === 1 && holders.length === 1)
            await joinShared(
              client,
              command.campaignId,
              command.tileIndex,
              holders[0]!,
              command.schoolSlot,
              Date.now(),
            );
          if (this.#boundary?.ruleVersion === 1)
            await adjustKnowledgeScore(
              client,
              command.campaignId,
              command.schoolSlot,
              1,
            );
          const writeStart = performance.now();
          if (chunk.revision === 0x7fffffffffffffffn)
            throw new RangeError("World revision exhausted");
          if (this.#realtimeViews && viewRevision === 0x7fffffffffffffffn)
            throw new RangeError("School view revision exhausted");
          const next = chunk.revision + 1n;
          const newMask =
            maskAt(chunk.mask, local) | schoolBit(command.schoolSlot);
          chunk.mask.writeUInt16LE(newMask, local * 2);
          chunk.fog[local >> 3]! |= 1 << (local & 7);
          await client.query(
            "UPDATE world_chunk_heads SET revision=$3 WHERE campaign_id=$1 AND chunk_id=$2",
            [command.campaignId, id, next.toString()],
          );
          if (campaign.rows[0].write_strategy === "full_chunk") {
            await client.query(
              "UPDATE world_chunks SET revision=$3,mask=$4,mask_crc=$5 WHERE campaign_id=$1 AND chunk_id=$2",
              [
                command.campaignId,
                id,
                next.toString(),
                chunk.mask,
                crc32(chunk.mask),
              ],
            );
            await client.query(
              "UPDATE school_fog_chunks SET revision=$4,fog=$5,fog_crc=$6 WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
              [
                command.campaignId,
                id,
                command.schoolSlot,
                next.toString(),
                chunk.fog,
                crc32(chunk.fog),
              ],
            );
          } else {
            await client.query(
              "INSERT INTO world_mutations(campaign_id,chunk_id,revision,local_index,school_slot,new_mask,discovered,command_actor,command_key) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8)",
              [
                command.campaignId,
                id,
                next.toString(),
                local,
                command.schoolSlot,
                newMask,
                command.actorId,
                Buffer.from(command.key),
              ],
            );
          }
          if (this.#boundary?.ruleVersion === 1) {
            const fogs = new Map<number, { fog: Buffer; revision: string }>();
            for (
              let dz = -GAME_CONFIG.world.fogRevealRadius;
              dz <= GAME_CONFIG.world.fogRevealRadius;
              dz++
            )
              for (
                let dx = -GAME_CONFIG.world.fogRevealRadius;
                dx <= GAME_CONFIG.world.fogRevealRadius;
                dx++
              ) {
                const nx = x + dx,
                  nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= 1000 || nz >= 1000) continue;
                const fid = chunkId(Math.floor(nx / 64), Math.floor(nz / 64));
                let state = fogs.get(fid);
                if (!state) {
                  const head = (
                    await client.query<{ revision: string }>(
                      "SELECT revision FROM world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2",
                      [command.campaignId, fid],
                    )
                  ).rows[0]!;
                  const row = (
                    await client.query<{ fog: Buffer }>(
                      "SELECT fog FROM school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
                      [command.campaignId, fid, command.schoolSlot],
                    )
                  ).rows[0];
                  state = {
                    fog: Buffer.from(row?.fog ?? ZERO_FOG),
                    revision: head.revision,
                  };
                  fogs.set(fid, state);
                }
                const flocal = localIndex(nx, nz);
                state.fog[flocal >> 3]! |= 1 << (flocal & 7);
              }
            for (const [fid, state] of fogs) {
              await client.query(
                "INSERT INTO school_fog_chunks(campaign_id,chunk_id,school_slot,revision,fog,fog_crc) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(campaign_id,chunk_id,school_slot) DO UPDATE SET revision=EXCLUDED.revision,fog=EXCLUDED.fog,fog_crc=EXCLUDED.fog_crc",
                [
                  command.campaignId,
                  fid,
                  command.schoolSlot,
                  state.revision,
                  state.fog,
                  crc32(state.fog),
                ],
              );
              if (fid !== id)
                await client.query(
                  "INSERT INTO school_chunk_views(campaign_id,chunk_id,school_slot,view_revision) VALUES($1,$2,$3,1) ON CONFLICT(campaign_id,chunk_id,school_slot) DO UPDATE SET view_revision=school_chunk_views.view_revision+1",
                  [command.campaignId, fid, command.schoolSlot],
                );
            }
          }
          worldWriteMs = performance.now() - writeStart;
          if (this.#realtimeViews) {
            viewRevision++;
            await client.query(
              "UPDATE school_chunk_views SET view_revision=$4 WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
              [
                command.campaignId,
                id,
                command.schoolSlot,
                viewRevision.toString(),
              ],
            );
          }
          if (effectiveCost > 0n)
            await client.query(
              "INSERT INTO ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'fixture-credit',$4)",
              [
                command.campaignId,
                command.actorId,
                Buffer.from(command.key),
                (-effectiveCost).toString(),
              ],
            );
          const outbox = await client.query<{ id: string }>(
            "INSERT INTO outbox_events(campaign_id,actor_id,command_key,event_type,event_version,payload) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
            [
              command.campaignId,
              command.actorId,
              Buffer.from(command.key),
              this.#realtimeViews
                ? "m35_fixture_world_changed"
                : "m3_test_world_changed",
              this.#realtimeViews ? 2 : 1,
              JSON.stringify({
                chunkId: id,
                schoolSlot: command.schoolSlot,
                localIndex: local,
                ...(this.#realtimeViews
                  ? {
                      viewRevision: viewRevision.toString(),
                      mask: newMask & schoolBit(command.schoolSlot),
                      discovered: true,
                    }
                  : { revision: next.toString() }),
              }),
            ],
          );
          outboxId = outbox.rows[0]?.id;
          result = {
            status: "test_applied",
            reason: "none",
            chunkId: id,
            revision: next.toString(),
            balance: wallet.rows[0].balance,
            ...(this.#realtimeViews
              ? { viewRevision: viewRevision.toString() }
              : {}),
          };
        }
      }
      await client.query(
        "UPDATE command_results SET status=$4,result=$5 WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [
          command.campaignId,
          command.actorId,
          Buffer.from(command.key),
          result.status,
          JSON.stringify(result),
        ],
      );
      hooks.beforeCommit?.();
      await client.query("COMMIT");
      const committedAtMs = performance.now();
      const committedAtMonotonicMs = Number(process.hrtime.bigint()) / 1e6;
      committed = true;
      hooks.afterCommit?.();
      return {
        result,
        ...(outboxId ? { outboxId } : {}),
        metrics: {
          transactionMs: performance.now() - start,
          poolWaitMs,
          poolAcquiredAtMonotonicMs,
          dbTransactionMs: committedAtMs - dbStarted,
          committedAtMs,
          committedAtMonotonicMs,
          headLockWaitMs,
          worldReadMs,
          worldWriteMs,
          committed,
          replayed,
        },
      };
    } catch (error) {
      if (!committed) await client.query("ROLLBACK");
      else
        throw new CommittedResultInterrupted(
          error instanceof Error
            ? error.message
            : "Post-commit response interrupted",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}

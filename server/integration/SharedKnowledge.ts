import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { edgeNeighbors } from "../../shared/gameplay/expansion.ts";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  chunkId,
  localIndex,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { adjustKnowledgeScore } from "./KnowledgeScore.ts";
export interface SharedCluster {
  id: string;
  pair: number[];
  tiles: { tile: number; incumbent: number }[];
  createdAt: number;
  due: Record<string, number>;
  status: "shared" | "consolidating";
  guest?: number;
  hardUntil?: number;
  rollingUntil?: number;
  required?: number;
  escrow: Record<string, number>;
}
export async function clusters(
  db: PoolClient,
  campaign: string,
): Promise<SharedCluster[]> {
  return (
    await db.query<{ data: SharedCluster }>(
      "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='shared-cluster' ORDER BY id",
      [campaign],
    )
  ).rows.map((r) => r.data);
}
async function save(
  db: PoolClient,
  campaign: string,
  c: SharedCluster,
): Promise<void> {
  await db.query(
    "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'shared-cluster',$2,$3) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
    [campaign, c.id, JSON.stringify(c)],
  );
}
async function remove(
  db: PoolClient,
  campaign: string,
  c: SharedCluster,
): Promise<void> {
  await db.query(
    "DELETE FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='shared-cluster' AND id=$2",
    [campaign, c.id],
  );
}
async function notice(
  db: PoolClient,
  campaign: string,
  slots: number[],
  title: string,
  body: string,
): Promise<void> {
  for (const slot of slots)
    await db.query(
      "INSERT INTO r2pl_v2.game_events(campaign_id,school_slot,title,body) VALUES($1,$2,$3,$4)",
      [campaign, slot, title, body],
    );
}
/** Called inside the same signed explore transaction; pair-connected clusters merge durably. */
export async function joinShared(
  db: PoolClient,
  campaign: string,
  tile: number,
  incumbent: number,
  guest: number,
  now: number,
): Promise<void> {
  const pair = [incumbent, guest].sort((a, b) => a - b),
    neighbors = new Set(edgeNeighbors(tile));
  const touching = (await clusters(db, campaign)).filter(
    (c) =>
      c.status === "shared" &&
      c.pair.join(",") === pair.join(",") &&
      c.tiles.some((t) => neighbors.has(t.tile)),
  );
  touching.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const c: SharedCluster = touching[0] ?? {
    id: randomUUID(),
    pair,
    tiles: [],
    createdAt: now,
    due: Object.fromEntries(
      pair.map((s) => [
        s,
        now +
          GAME_CONFIG.knowledge.freeUpkeepMs +
          GAME_CONFIG.knowledge.upkeepCycleMs,
      ]),
    ),
    status: "shared",
    escrow: {},
  };
  for (const other of touching.slice(1)) {
    c.tiles.push(...other.tiles);
    for (const slot of pair)
      c.due[String(slot)] = Math.min(
        c.due[String(slot)]!,
        other.due[String(slot)]!,
      );
    await remove(db, campaign, other);
  }
  c.tiles.push({ tile, incumbent });
  await save(db, campaign, c);
  await notice(
    db,
    campaign,
    pair,
    "Shared Knowledge",
    `${c.tiles.length} ô giao lưu · 24 giờ đầu miễn upkeep`,
  );
}
async function systemKey(
  db: PoolClient,
  campaign: string,
  actor: string,
): Promise<Buffer> {
  const key = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  await db.query(
    "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status,result) VALUES($1,$2,$3,$4,'test_applied',$5)",
    [
      campaign,
      actor,
      key,
      Buffer.alloc(32),
      JSON.stringify({ lifecycle: true }),
    ],
  );
  return key;
}
/** Emits only a school's own bit; remembered fog is retained after a lapse. */
async function ownership(
  db: PoolClient,
  campaign: string,
  tile: number,
  newMask: number,
  actor: string,
): Promise<void> {
  const { x, z } = tileCoordinates(tile),
    id = chunkId(Math.floor(x / 64), Math.floor(z / 64)),
    local = localIndex(x, z);
  await db.query(
    "SELECT revision FROM r2pl_v2.world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
    [campaign, id],
  );
  const row = (
    await db.query<{ mask: Buffer }>(
      "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
      [campaign, id],
    )
  ).rows[0]!;
  const mask = Buffer.from(row.mask),
    old = mask.readUInt16LE(local * 2);
  if (old === newMask) return;
  mask.writeUInt16LE(newMask, local * 2);
  const revision = (
    await db.query<{ revision: string }>(
      "UPDATE r2pl_v2.world_chunk_heads SET revision=revision+1 WHERE campaign_id=$1 AND chunk_id=$2 RETURNING revision",
      [campaign, id],
    )
  ).rows[0]!.revision;
  await db.query(
    "UPDATE r2pl_v2.world_chunks SET revision=$3,mask=$4,mask_crc=$5 WHERE campaign_id=$1 AND chunk_id=$2",
    [campaign, id, revision, mask, crc32(mask)],
  );
  for (let slot = 0; slot < 16; slot++)
    if ((old ^ newMask) & (1 << slot)) {
      await adjustKnowledgeScore(
        db,
        campaign,
        slot,
        newMask & (1 << slot) ? 1 : -1,
      );
      const view = (
        await db.query<{ view_revision: string }>(
          "UPDATE r2pl_v2.school_chunk_views SET view_revision=view_revision+1 WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3 RETURNING view_revision",
          [campaign, id, slot],
        )
      ).rows[0];
      if (!view) continue;
      const key = await systemKey(db, campaign, actor);
      await db.query(
        "INSERT INTO r2pl_v2.outbox_events(campaign_id,actor_id,command_key,event_type,event_version,payload) VALUES($1,$2,$3,'m35_fixture_world_changed',2,$4)",
        [
          campaign,
          actor,
          key,
          JSON.stringify({
            chunkId: id,
            schoolSlot: slot,
            viewRevision: view.view_revision,
            localIndex: local,
            mask: newMask & (1 << slot),
            discovered: true,
          }),
        ],
      );
    }
}
async function refund(
  db: PoolClient,
  campaign: string,
  c: SharedCluster,
): Promise<void> {
  for (const [actor, amount] of Object.entries(c.escrow)) {
    if (!amount) continue;
    const key = await systemKey(db, campaign, actor);
    await db.query(
      "INSERT INTO r2pl_v2.game_events(campaign_id,actor_id,title,body) VALUES($1,$2,$3,$4)",
      [
        campaign,
        actor,
        "Hoàn Points consolidation",
        `${amount} Points đã hoàn vào ví`,
      ],
    );
    await db.query(
      "UPDATE r2pl_v2.wallet_accounts SET balance=balance+$3 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-credit'",
      [campaign, actor, amount],
    );
    await db.query(
      "INSERT INTO r2pl_v2.ledger_entries(campaign_id,actor_id,command_key,resource,amount) VALUES($1,$2,$3,'fixture-credit',$4)",
      [campaign, actor, key, amount],
    );
  }
}
/** All callers take the signed campaign lock before this function. No wall-clock sleep is needed. */
export async function settleShared(
  db: PoolClient,
  campaign: string,
  systemActor: string,
  now: number,
): Promise<void> {
  for (const c of await clusters(db, campaign)) {
    if (c.status === "consolidating") {
      if (now >= c.hardUntil! || now >= c.rollingUntil!) {
        for (const t of c.tiles)
          await ownership(db, campaign, t.tile, 0, systemActor);
        await notice(
          db,
          campaign,
          c.pair,
          "Consolidation hết hạn",
          `${c.tiles.length} ô trở về trung lập; hoàn đóng góp cho từng người`,
        );
        await refund(db, campaign, c);
        await remove(db, campaign, c);
      }
      continue;
    }
    const lapsed = c.pair.filter((s) => (c.due[String(s)] ?? 0) <= now);
    if (!lapsed.length) continue;
    if (lapsed.length === 2) {
      for (const t of c.tiles)
        await ownership(db, campaign, t.tile, 1 << t.incumbent, systemActor);
      await notice(
        db,
        campaign,
        c.pair,
        "Upkeep hết hạn",
        "Guest hết hạn; incumbent giữ Knowledge miễn phí",
      );
      await remove(db, campaign, c);
      continue;
    }
    const failed = lapsed[0]!,
      remaining = c.pair.find((s) => s !== failed)!;
    const inherited = c.tiles.filter((t) => t.incumbent === failed);
    for (const t of c.tiles)
      await ownership(db, campaign, t.tile, 1 << remaining, systemActor);
    await notice(
      db,
      campaign,
      c.pair,
      "Upkeep hết hạn",
      inherited.length
        ? `${inherited.length} ô vào cửa sổ consolidation`
        : "Incumbent giữ Knowledge miễn phí",
    );
    if (!inherited.length) {
      await remove(db, campaign, c);
      continue;
    }
    c.tiles = inherited;
    c.status = "consolidating";
    c.guest = remaining;
    c.required = Math.ceil(
      inherited.length / GAME_CONFIG.knowledge.consolidationTilesPerPoint,
    );
    c.hardUntil = now + GAME_CONFIG.knowledge.consolidationHardMs;
    c.rollingUntil = now + GAME_CONFIG.knowledge.consolidationRollingMs;
    await save(db, campaign, c);
  }
}
export async function payShared(
  db: PoolClient,
  campaign: string,
  actor: string,
  slot: number,
  id: string,
  amount: number,
  action: "upkeep" | "consolidate",
  charge: (amount: number) => Promise<void>,
  now: number,
): Promise<void> {
  const c = (await clusters(db, campaign)).find(
    (c) => c.id === id && c.pair.includes(slot),
  );
  if (!c) throw new RangeError("Unknown school cluster");
  if (action === "upkeep") {
    if (
      c.status !== "shared" ||
      now < c.createdAt + GAME_CONFIG.knowledge.freeUpkeepMs
    )
      throw new RangeError("Upkeep not due");
    if (amount !== GAME_CONFIG.knowledge.upkeepPoints)
      throw new RangeError("Upkeep costs 1 Point");
    await charge(amount);
    c.due[String(slot)] =
      (c.due[String(slot)] ?? now) + GAME_CONFIG.knowledge.upkeepCycleMs;
    await save(db, campaign, c);
    return;
  }
  if (c.status !== "consolidating" || c.guest !== slot)
    throw new RangeError("Not your consolidation");
  const total = Object.values(c.escrow).reduce((a, b) => a + b, 0),
    needed = c.required! - total;
  const contribution = Math.min(amount, needed);
  if (contribution < 1) throw new RangeError("Already consolidated");
  await charge(contribution);
  c.escrow[actor] = (c.escrow[actor] ?? 0) + contribution;
  c.rollingUntil = Math.min(
    c.hardUntil!,
    now + GAME_CONFIG.knowledge.consolidationRollingMs,
  );
  if (total + contribution >= c.required!) {
    await remove(db, campaign, c);
    await notice(
      db,
      campaign,
      c.pair,
      "Consolidation hoàn tất",
      `${c.tiles.length} ô được giữ bởi trường đóng góp`,
    );
    return;
  }
  await save(db, campaign, c);
}

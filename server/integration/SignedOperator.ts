import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import {
  GAME_CONFIG,
  LANDMARKS,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import { chunkId, localIndex } from "../../shared/world/coordinates.ts";
import { adjustKnowledgeScore } from "./KnowledgeScore.ts";
import type { SchoolPlayFixture } from "./SchoolPlayFixture.ts";
export class SignedOperator {
  private pool: Pool;
  private fixture: SchoolPlayFixture;
  private adminKey: string;
  private resync: () => Promise<void>;
  constructor(
    pool: Pool,
    fixture: SchoolPlayFixture,
    adminKey: string,
    resync: () => Promise<void>,
  ) {
    this.pool = pool;
    this.fixture = fixture;
    this.adminKey = adminKey;
    this.resync = resync;
  }
  authorized(key: string | undefined): boolean {
    if (!key) return false;
    const a = Buffer.from(key),
      b = Buffer.from(this.adminKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async layout(): Promise<readonly WorldObject[]> {
    return (
      await this.pool.query<{ data: WorldObject }>(
        "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 ORDER BY id",
        [this.fixture.campaignId],
      )
    ).rows.map((r) => r.data);
  }
  async apply(input: unknown): Promise<void> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("Invalid admin command");
    const c = input as {
      action?: unknown;
      objects?: unknown;
      title?: unknown;
      body?: unknown;
      tier?: unknown;
      amount?: unknown;
    };
    const db = await this.pool.connect();
    let committed = false;
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.fixture.campaignId}`,
      ]);
      if (c.action === "gift-stock") {
        if (
          typeof c.tier !== "string" ||
          !["aspire", "nitro", "predator"].includes(c.tier) ||
          !Number.isSafeInteger(c.amount) ||
          Number(c.amount) < 0 ||
          Number(c.amount) > 100000
        )
          throw new TypeError("Invalid Gift stock");
        await db.query(
          "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-stock',$2,$3) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
          [
            this.fixture.campaignId,
            c.tier,
            JSON.stringify({ remaining: c.amount }),
          ],
        );
        await db.query(
          "INSERT INTO r2pl_v2.game_events(campaign_id,title,body) VALUES($1,$2,$3)",
          [
            this.fixture.campaignId,
            "Staging Gift stock",
            `${c.tier} = ${c.amount}`,
          ],
        );
        await db.query("COMMIT");
        committed = true;
        return;
      }
      if (c.action === "notify") {
        if (
          typeof c.title !== "string" ||
          typeof c.body !== "string" ||
          c.title.length > 100 ||
          c.body.length > 500
        )
          throw new TypeError("Invalid notification");
        await db.query(
          "INSERT INTO r2pl_v2.game_events(campaign_id,title,body) VALUES($1,$2,$3)",
          [this.fixture.campaignId, c.title, c.body],
        );
        await db.query("COMMIT");
        committed = true;
        return;
      }
      const previous = (
        await db.query<{ data: WorldObject }>(
          "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 ORDER BY id",
          [this.fixture.campaignId],
        )
      ).rows.map((r) => r.data);
      let objects: WorldObject[];
      if (c.action === "rollback") {
        const saved = (
          await db.query<{ data: WorldObject[] }>(
            "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='layout-backup' AND id='previous'",
            [this.fixture.campaignId],
          )
        ).rows[0];
        if (!saved) throw new TypeError("No previous layout");
        objects = saved.data;
      } else if (c.action === "publish" && Array.isArray(c.objects))
        objects = c.objects as WorldObject[];
      else throw new TypeError("Invalid admin action");
      if (objects.length > 200 || objects.length < 18)
        throw new RangeError("Invalid object count");
      const ids = new Set<string>();
      for (const o of objects) {
        if (
          !o ||
          typeof o !== "object" ||
          !/^[a-z0-9_-]{1,100}$/.test(o.id) ||
          ids.has(o.id) ||
          !["hq", "landmark", "unistop", "chest"].includes(o.kind) ||
          typeof o.name !== "string" ||
          o.name.length > 100 ||
          ![o.x, o.z, o.width, o.height].every(Number.isInteger)
        )
          throw new TypeError("Invalid world object");
        if (
          Object.keys(o).some(
            (k) =>
              ![
                "id",
                "kind",
                "name",
                "x",
                "z",
                "width",
                "height",
                "schoolSlot",
                "tier",
                "ownerSchoolSlot",
                "ownerSchoolId",
              ].includes(k),
          )
        )
          throw new TypeError("Unknown world object field");
        if (/[<>]/.test(o.name)) throw new TypeError("Invalid object name");
        ids.add(o.id);
        const f = GAME_CONFIG.footprints[o.kind];
        if (
          o.width !== f.width ||
          o.height !== f.height ||
          o.x - o.width / 2 < 0 ||
          o.z - o.height / 2 < 0 ||
          o.x + o.width / 2 > 1000 ||
          o.z + o.height / 2 > 1000
        )
          throw new RangeError("Invalid footprint");
        if (
          o.kind === "hq" &&
          !SCHOOLS.some((s) => s.slot === o.schoolSlot && o.id === `hq-${s.id}`)
        )
          throw new TypeError("Invalid HQ");
        if (o.kind === "landmark" && !LANDMARKS.some((l) => l.id === o.id))
          throw new TypeError("Invalid landmark");
        if (
          (o.kind === "unistop" || o.kind === "chest") &&
          !["aspire", "nitro", "predator"].includes(o.tier ?? "")
        )
          throw new TypeError("Invalid tier");
      }
      if (
        objects.filter((o) => o.kind === "hq").length !== 8 ||
        objects.filter((o) => o.kind === "landmark").length !== 10
      )
        throw new TypeError("Roster incomplete");
      for (let i = 0; i < objects.length; i++)
        for (let j = i + 1; j < objects.length; j++) {
          const a = objects[i]!,
            b = objects[j]!;
          if (
            Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
            Math.abs(a.z - b.z) < (a.height + b.height) / 2
          )
            throw new RangeError("Overlapping objects");
        }
      await db.query(
        "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'layout-backup','previous',$2) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
        [this.fixture.campaignId, JSON.stringify(previous)],
      );
      const moved = objects.filter(
        (o) =>
          o.kind === "hq" &&
          previous.some((p) => p.id === o.id && (p.x !== o.x || p.z !== o.z)),
      );
      const tileChanges = new Map<number, Map<number, number>>();
      const reveal = new Map<
        string,
        { id: number; slot: number; locals: number[] }
      >();
      for (const o of moved) {
        const old = previous.find((p) => p.id === o.id)!;
        for (const [area, remove] of [
          [old, true],
          [o, false],
        ] as const)
          for (
            let z = area.z - area.height / 2;
            z < area.z + area.height / 2;
            z++
          )
            for (
              let x = area.x - area.width / 2;
              x < area.x + area.width / 2;
              x++
            ) {
              const id = chunkId(Math.floor(x / 64), Math.floor(z / 64)),
                local = localIndex(x, z);
              let changes = tileChanges.get(id);
              if (!changes) {
                changes = new Map();
                tileChanges.set(id, changes);
              }
              const delta = remove ? -(1 << o.schoolSlot!) : 1 << o.schoolSlot!;
              changes.set(local, (changes.get(local) ?? 0) + delta);
              if (!remove) {
                const k = `${id}:${o.schoolSlot}`;
                let entry = reveal.get(k);
                if (!entry) {
                  entry = { id, slot: o.schoolSlot!, locals: [] };
                  reveal.set(k, entry);
                }
                entry.locals.push(local);
              }
            }
      }
      for (const id of [...tileChanges.keys()].sort((a, b) => a - b)) {
        await db.query(
          "INSERT INTO r2pl_v2.world_chunk_heads(campaign_id,chunk_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [this.fixture.campaignId, id],
        );
        await db.query(
          "SELECT revision FROM r2pl_v2.world_chunk_heads WHERE campaign_id=$1 AND chunk_id=$2 FOR UPDATE",
          [this.fixture.campaignId, id],
        );
        const row = (
          await db.query<{ mask: Buffer }>(
            "SELECT mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=$2",
            [this.fixture.campaignId, id],
          )
        ).rows[0];
        const mask = Buffer.from(row?.mask ?? Buffer.alloc(8192));
        for (const [local, delta] of tileChanges.get(id)!) {
          const current = mask.readUInt16LE(local * 2);
          if (delta > 0 && (current & ~delta) !== 0)
            throw new RangeError("HQ cannot replace rival Knowledge");
          const nextMask = delta < 0 ? current & ~-delta : current | delta;
          for (const s of SCHOOLS)
            if ((current ^ nextMask) & (1 << s.slot))
              await adjustKnowledgeScore(
                db,
                this.fixture.campaignId,
                s.slot,
                nextMask & (1 << s.slot) ? 1 : -1,
              );
          mask.writeUInt16LE(nextMask, local * 2);
        }
        const revision = (
          await db.query<{ revision: string }>(
            "UPDATE r2pl_v2.world_chunk_heads SET revision=revision+1 WHERE campaign_id=$1 AND chunk_id=$2 RETURNING revision",
            [this.fixture.campaignId, id],
          )
        ).rows[0]!.revision;
        await db.query(
          "INSERT INTO r2pl_v2.world_chunks(campaign_id,chunk_id,revision,mask,mask_crc) VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_id,chunk_id) DO UPDATE SET revision=EXCLUDED.revision,mask=EXCLUDED.mask,mask_crc=EXCLUDED.mask_crc",
          [this.fixture.campaignId, id, revision, mask, crc32(mask)],
        );
        for (const s of SCHOOLS)
          await db.query(
            "UPDATE r2pl_v2.school_chunk_views SET view_revision=view_revision+1 WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
            [this.fixture.campaignId, id, s.slot],
          );
      }
      for (const v of reveal.values()) {
        const old = (
          await db.query<{ fog: Buffer }>(
            "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND chunk_id=$2 AND school_slot=$3",
            [this.fixture.campaignId, v.id, v.slot],
          )
        ).rows[0];
        const fog = Buffer.from(old?.fog ?? Buffer.alloc(512));
        for (const local of v.locals) fog[local >> 3]! |= 1 << (local & 7);
        await db.query(
          "INSERT INTO r2pl_v2.school_fog_chunks(campaign_id,chunk_id,school_slot,fog,fog_crc) VALUES($1,$2,$3,$4,$5) ON CONFLICT(campaign_id,chunk_id,school_slot) DO UPDATE SET fog=EXCLUDED.fog,fog_crc=EXCLUDED.fog_crc",
          [this.fixture.campaignId, v.id, v.slot, fog, crc32(fog)],
        );
        await db.query(
          "INSERT INTO r2pl_v2.school_chunk_views(campaign_id,chunk_id,school_slot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [this.fixture.campaignId, v.id, v.slot],
        );
      }
      for (const o of objects)
        await db.query(
          "INSERT INTO r2pl_v2.game_world_objects(campaign_id,id,data) VALUES($1,$2,$3) ON CONFLICT(campaign_id,id) DO UPDATE SET data=EXCLUDED.data",
          [this.fixture.campaignId, o.id, JSON.stringify(o)],
        );
      await db.query(
        "DELETE FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND NOT(id=ANY($2::text[]))",
        [this.fixture.campaignId, [...ids]],
      );
      const digest = createHash("sha256")
        .update(JSON.stringify(objects))
        .digest("hex");
      await db.query(
        "INSERT INTO r2pl_v2.game_events(campaign_id,title,body) VALUES($1,$2,$3)",
        [this.fixture.campaignId, "Map published", digest],
      );
      await db.query("COMMIT");
      committed = true;
      for (const h of objects.filter((o) => o.kind === "hq")) {
        const area = this.fixture.headquarters.find(
          (a) => a.schoolSlot === h.schoolSlot,
        );
        if (area)
          Object.assign(area, { x: h.x - h.width / 2, z: h.z - h.height / 2 });
        for (const player of this.fixture.players.filter(
          (p) => p.slot === h.schoolSlot,
        ))
          Object.assign(player.home, { x: h.x, z: h.z });
      }
      await this.resync();
    } catch (e) {
      if (!committed) await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}

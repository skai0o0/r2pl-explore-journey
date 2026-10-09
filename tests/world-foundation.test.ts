import assert from "node:assert/strict";
import test from "node:test";
import { InProcessSectorRouter } from "../server/world/SectorAuthority.ts";
import { InMemoryWorldRepository } from "../server/world/WorldRepository.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { decodeFogChunk, decodeKnowledgeChunk } from "../shared/world/codec.ts";
import {
  CHUNK_COUNT,
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  SECTOR_COUNT,
  WORLD_TILE_COUNT,
} from "../shared/world/constants.ts";
import {
  chunkBounds,
  chunkCoordinates,
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  sectorCoordinates,
  sectorIdForTile,
  tileCoordinates,
  tileIndex,
} from "../shared/world/coordinates.ts";
import { SchoolRegistry, schoolBit } from "../shared/world/registry.ts";
import { WorldState } from "../shared/world/world.ts";

const synthetic = () =>
  new SchoolRegistry([
    { id: "school-a", slot: 0 },
    { id: "school-b", slot: 15 },
  ]);

test("immutable 16-slot registry preserves assignments during onboarding", () => {
  const original = synthetic();
  assert.equal(original.slotOf("school-a"), 0);
  assert.equal(original.slotOf("school-b"), 15);
  assert.equal(schoolBit(15), 0x8000);
  assert.throws(() => schoolBit(16));
  assert.throws(() => original.withSchool({ id: "school-a", slot: 1 }));
  assert.throws(() => original.withSchool({ id: "school-c", slot: 15 }));
  const extended = original.withSchool({ id: "school-c", slot: 8 });
  assert.equal(extended.size, 3);
  assert.equal(original.size, 2);
  assert.deepEqual(
    extended.entries().map((school) => school.slot),
    [0, 8, 15],
  );
  assert.throws(() => {
    (original.entries() as { id: string; slot: number }[])[0]!.slot = 7;
  });
  assert.equal(original.slotOf("school-a"), 0);
});

test("all million tile IDs round-trip and edge chunks clip correctly", () => {
  for (let index = 0; index < WORLD_TILE_COUNT; index++) {
    const { x, z } = tileCoordinates(index);
    assert.equal(tileIndex(x, z), index);
  }
  assert.equal(tileIndex(999, 999), 999_999);
  assert.deepEqual(chunkCoordinates(999, 999), { chunkX: 15, chunkZ: 15 });
  assert.deepEqual(chunkCoordinatesForIndex(999_999), {
    chunkX: 15,
    chunkZ: 15,
  });
  assert.deepEqual(chunkBounds(15, 15), {
    x: 960,
    z: 960,
    width: 40,
    height: 40,
  });
  assert.equal(localIndex(999, 999), 39 * 64 + 39);
  assert.equal(chunkId(15, 15), CHUNK_COUNT - 1);
  assert.deepEqual(sectorCoordinates(15, 15), { sectorX: 3, sectorZ: 3 });
  assert.equal(sectorIdForTile(999_999), SECTOR_COUNT - 1);
  for (const [x, z] of [
    [-1, 0],
    [1000, 0],
    [0.5, 0],
    [0, Number.NaN],
    [0, 1000],
  ]) {
    assert.throws(() => tileIndex(x!, z!));
  }
  assert.throws(() => tileCoordinates(1_000_000));
});

test("knowledge and fog chunks have deterministic little-endian bytes and reject corrupt edges", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const world = new WorldState(synthetic());
  const first = tileIndex(0, 0);
  const edge = tileIndex(999, 999);
  world.setPresence(first, 0, true);
  world.setPresence(edge, 15, true);
  assert.equal(world.maskByteLength, 2_000_000);
  assert.equal(world.maskAt(edge), 0x8000);
  assert.equal(world.hasKnowledge(edge, 0), false);
  const firstChunk = world.knowledgeChunk(0, 0);
  assert.equal(firstChunk.payload.byteLength, CHUNK_MASK_BYTES);
  assert.equal(firstChunk.checksum, 1838313334); // v1 golden fixture
  assert.deepEqual([...firstChunk.payload.subarray(0, 2)], [1, 0]);
  const edgeChunk = world.knowledgeChunk(15, 15);
  assert.equal(edgeChunk.checksum, 3837399401); // v1 golden fixture
  const offset = localIndex(999, 999) * 2;
  assert.deepEqual(
    [...edgeChunk.payload.subarray(offset, offset + 2)],
    [0, 0x80],
  );
  assert.equal(decodeKnowledgeChunk(edgeChunk)[localIndex(999, 999)], 0x8000);
  assert.deepEqual(world.knowledgeChunk(15, 15).payload, edgeChunk.payload);

  let badPadding = structuredClone(edgeChunk);
  badPadding.payload[CHUNK_MASK_BYTES - 1] = 1;
  badPadding = { ...badPadding, checksum: crc32(badPadding.payload) };
  assert.throws(() => decodeKnowledgeChunk(badPadding), /padding/);
  const badChecksum = structuredClone(edgeChunk);
  badChecksum.payload[offset] = 1;
  assert.throws(() => decodeKnowledgeChunk(badChecksum), /checksum/);
  assert.throws(
    () => decodeKnowledgeChunk({ ...edgeChunk, formatVersion: 2 }),
    /format/,
  );
  assert.throws(
    () =>
      decodeKnowledgeChunk({
        ...edgeChunk,
        payload: edgeChunk.payload.subarray(1),
      }),
    /length/,
  );
  assert.throws(
    () => decodeKnowledgeChunk({ ...edgeChunk, revision: -1n }),
    /revision/,
  );

  world.reveal(edge, 15);
  assert.equal(world.isRevealed(edge, 15), true);
  assert.equal(world.isRevealed(edge, 0), false);
  assert.equal(world.fogByteLength, CHUNK_FOG_BYTES);
  const fog = world.fogChunk(15, 15, 15)!;
  assert.equal(fog.checksum, 1249749781); // v1 golden fixture
  assert.equal(fog.payload.byteLength, CHUNK_FOG_BYTES);
  assert.equal(
    fog.payload[localIndex(999, 999) >> 3],
    1 << (localIndex(999, 999) & 7),
  );
  assert.deepEqual(decodeFogChunk(fog), fog.payload);
  let badFog = structuredClone(fog);
  badFog.payload[CHUNK_FOG_BYTES - 1] = 1;
  badFog = { ...badFog, checksum: crc32(badFog.payload) };
  assert.throws(() => decodeFogChunk(badFog), /padding/);
});

test("seeded multi-chunk fixture round-trips all school bits and deterministic payloads", () => {
  const registry = new SchoolRegistry(
    Array.from({ length: 16 }, (_, slot) => ({ id: `fixture-${slot}`, slot })),
  );
  const world = new WorldState(registry);
  let seed = 0x12345678;
  for (let i = 0; i < 10_000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const tile = seed % WORLD_TILE_COUNT;
    world.setPresence(tile, i % 16, true);
    if (i % 101 === 0) world.reveal(tile, i % 16);
  }
  const snapshot = world.snapshot();
  const restored = WorldState.restore(snapshot, registry);
  for (let i = 0; i < WORLD_TILE_COUNT; i++)
    assert.equal(restored.maskAt(i), world.maskAt(i));
  assert.deepEqual(restored.snapshot(), snapshot);
});

test("full snapshot restore validates registry, metadata and every chunk", async () => {
  const registry = synthetic();
  const world = new WorldState(registry);
  const tile = tileIndex(63, 64);
  world.setPresence(tile, 0, true);
  world.setPresence(tile, 15, true);
  world.setMetadata({
    tileIndex: tile,
    schoolSlot: 15,
    formatVersion: 1,
    payload: Uint8Array.of(7, 8, 9),
  });
  world.reveal(tile, 15);
  const snapshot = world.snapshot();
  assert.equal(snapshot.chunks.length, 256);
  const repository = new InMemoryWorldRepository();
  await repository.save(snapshot);
  world.setPresence(tile, 15, false);
  const loaded = await repository.load();
  assert.ok(loaded);
  const restored = WorldState.restore(
    loaded,
    registry.withSchool({ id: "school-c", slot: 8 }),
  );
  assert.equal(restored.maskAt(tile), 0x8001);
  assert.deepEqual(
    restored.metadataAt(tile, 15)?.payload,
    Uint8Array.of(7, 8, 9),
  );
  assert.equal(restored.isRevealed(tile, 15), true);
  assert.deepEqual(restored.snapshot().chunks, snapshot.chunks);
  assert.throws(
    () =>
      WorldState.restore(
        snapshot,
        new SchoolRegistry([
          { id: "school-a", slot: 1 },
          { id: "school-b", slot: 15 },
        ]),
      ),
    /registry/,
  );
  assert.throws(
    () =>
      WorldState.restore(
        { ...snapshot, chunks: snapshot.chunks.slice(1) },
        registry,
      ),
    /Incomplete/,
  );
  assert.throws(
    () =>
      WorldState.restore(
        {
          ...snapshot,
          chunks: [...snapshot.chunks.slice(0, -1), snapshot.chunks[0]!],
        },
        registry,
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      WorldState.restore(
        {
          ...snapshot,
          metadata: [
            {
              tileIndex: tileIndex(0, 0),
              schoolSlot: 0,
              formatVersion: 1,
              payload: Uint8Array.of(1),
            },
          ],
        },
        registry,
      ),
    /mismatch/,
  );
  assert.throws(
    () =>
      WorldState.restore(
        { ...snapshot, fog: [...snapshot.fog, snapshot.fog[0]!] },
        registry,
      ),
    /Duplicate/,
  );
});

test("all 16 in-process sectors route exactly 16 chunks and reject cross-sector writes", () => {
  const world = new WorldState(synthetic());
  const router = new InProcessSectorRouter(world);
  assert.equal(router.sectorCount(), 16);
  for (let id = 0; id < 16; id++)
    assert.equal(router.chunkIdsForSector(id).length, 16);
  const tile = tileIndex(999, 999);
  const authority = router.forTile(tile);
  assert.equal(authority.id, 15);
  assert.equal(authority.setPresence(tile, 15, true), true);
  assert.equal(authority.setPresence(tile, 15, true), false);
  assert.equal(authority.readChunk(15, 15).revision, 1n);
  assert.throws(
    () => router.forChunk(0, 0).setPresence(tile, 15, false),
    /another sector/,
  );
  assert.throws(() => authority.readChunk(0, 0), /another sector/);
});

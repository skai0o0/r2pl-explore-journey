# R2PL Game V2 architecture — accepted baseline, M1 implementation

## Boundary and dependency direction

```text
client/ (Three.js, HUD) ──binary/versioned protocol──> server/ Colyseus gateway
       ▲                                             │
       │ snapshots, deltas, action results            ▼
       └──────────────────────────────────── gameplay services → SectorAuthority
                                      │                 │
                                      ▼                 ▼
                                   shared/          repositories → PostgreSQL
                                 pure contracts                    │
                                                                   outbox worker
```

`shared/` has no runtime dependency on client, room, database, or environment. Rooms authenticate, subscribe, limit traffic and route commands; they do not decide rule outcomes. Gameplay services receive a trusted identity, a versioned rule set, a sector authority and a transaction unit. Repositories hide SQL from business rules but expose transactions and compare-and-swap/locking explicitly. Rendering consumes authorized view models only.

## World authority

The campaign has coordinates `x,z ∈ [0,999]`, row-major tile index `z*1000+x`, 256 logical chunks and 16 sectors. A chunk is 64×64, with right/bottom edge cells clipped to 40 real tiles on the final chunk. A sector maps `sectorX=floor(chunkX/4)`, `sectorZ=floor(chunkZ/4)`. The 16 school bits and 16 sectors are unrelated dimensions.

The dense uint16 array stores only current school presence. Sparse records store per-school knowledge strength/timestamps and other dynamic state. Per-school fog is a separate bitset; discovery persistence and visibility rules are separate from knowledge decay. The database records the stable campaign school-slot registry. World format changes require a new version and migration; slot reassignment is forbidden while any saved mask uses it.

The M1 `SectorAuthority` contract exposes `readChunk` and inert `setPresence` within a sector boundary. Its replaceable in-process router owns 16 logical sectors. It has no network command queue, persistence or production concurrency guarantee. M2/M3 must extend the authority with ordered commands, subscriptions, recovery and transaction integration. Multi-sector actions will need deterministic sector ordering and one database transaction or an explicit saga with idempotent compensation. Future process ownership uses a durable epoch/fencing token checked by every commit, not just a Redis lock.

## Command and commit path

`receive → decode/size check → authenticate → authorize/visibility check → validate rule and preconditions → route → transaction lock/idempotency check → calculate → commit world + ledger + idempotency + outbox → acknowledge → publish authorized deltas`.

The transaction is the linearization point. A retry with the same actor/key/payload returns the stored result; the same key with a different payload is rejected. A crash after commit but before acknowledgement is safe to retry. A failed transaction has no spend or world effect. Outbox delivery may repeat, so consumers deduplicate by event ID. M2's in-memory adapter only supports convergence tests and is not a production mutation path. ADR-011 leaves the physical PostgreSQL world-write strategy open until M3 benchmarks; the transaction must durably commit a world mutation/revision together with the economy ledger and idempotency result. A later materialized chunk snapshot is a recoverable projection, never the sole record behind a success ack.

## Synchronization and privacy

The gateway maintains authorized viewport chunk subscriptions. On subscription, capture a revision fence, register for future changes, send a snapshot at that revision, then deliver buffered later revisions; alternatively replay from the fence. A delta includes base and next revision. The client applies only a contiguous change and asks for a chunk snapshot on a gap, format mismatch, or reconnect. Large initial views are bounded and paged. Fog and unrevealed metadata are filtered by school/player permissions before serialization. A public map overview must use an explicitly approved coarse data policy.

Chunk change buffers and outbound queues are bounded. Slow clients resync or disconnect rather than retaining unlimited deltas. Rate limits are per trusted identity and connection, with separate administrative limits. Command acks are private to the actor; only committed, visible state becomes shared output.

## Rendering and operations

The M1 placeholder renders a synthetic 1,000×1,000 RGBA data texture through one plane in two scissored views (overview and local). It creates no per-tile Mesh or DOM nodes. This is a fixture, not the final map/visibility renderer. Later detailed views may use viewport-sized instanced geometry or buffers. The 64×64 data chunk does not require a 64×64 render mesh. V1's 50×50 instancing, candidate-chunk raycasting and fog texture upload throttling remain benchmark candidates.

Initial deployment is one modular monolith process with PostgreSQL. Separate outbox/worker or gateway roles only when operationally needed. Redis Presence/Driver and distributed sector processes are M7 options after measured limits. Logs include request/campaign/sector/revision IDs, never tokens or raw student identifiers. See `DATA_MODEL.md`, `PROTOCOL.md`, `PERFORMANCE_TARGETS.md`, and `OPERATIONS.md`.

## Architecture risks to test

1. M2/M3 durability sequencing: production commit-success is disabled until durable transactions exist.
2. Large hotspots can saturate one sector despite low global action rate; measure queue wait and revise routing only with evidence.
3. Shared knowledge and fog can expose hidden schools if raw masks are sent without visibility filtering.
4. Per-action chunk rewrites may amplify writes and contend on hotspot rows; deferred snapshots require replayable durable mutations and bounded recovery. ADR-011 is open until M3 measurements.
5. Initial viewport and overview strategies need browser/GPU and outbound-byte measurements before choosing cache residency.

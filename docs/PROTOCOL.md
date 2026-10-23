# V2 binary contracts: world v1 and M2 realtime v1

## World format v1 (unchanged from M1)

- Coordinates: `x,z` are integers 0–999. `tileIndex=z*1000+x`. Chunk coordinates are `floor(x/64),floor(z/64)` (0–15); local index is `(z%64)*64+(x%64)`. Sector coordinates are `floor(chunkX/4),floor(chunkZ/4)` (0–3).
- A knowledge chunk is 4096 row-major unsigned 16-bit masks, exactly 8192 little-endian bytes. Bit `b` is school slot `b`, 0–15. It says presence only. Edge padding must be zero. The bottom-right chunk has 40×40 real cells.
- A school fog chunk is 512 bytes. Local bit `i` is byte `i>>3`, bit `i&7`; set means discovered. Edge padding must be zero. Knowledge and fog have separate meanings.
- M1 records carry world format 1, chunk coordinates, unsigned 64-bit revision and CRC-32/ISO-HDLC payload checksum. School assignments come only from an immutable campaign registry. The proposed V1 school names are **not** executable V2 data.

## M2 transport envelope

All multibyte fields are little endian. CRC is CRC-32/ISO-HDLC over every preceding frame byte. Incoming frames are at most **1024 bytes**, including envelope. Unknown version, kind, length, nonzero reserved bytes or bad CRC fails closed. A Colyseus `m2` binary message contains exactly one frame.

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 2 | ASCII `R2` (`52 32`) |
| 2 | 1 | Protocol version `01` |
| 3 | 1 | Kind |
| 4 | 2 | Payload byte length |
| 6 | 2 | Reserved zero |
| 8 | length | Kind-specific payload |
| 8+length | 4 | CRC32 of offsets 0 through 7+length |

| Kind | Code | Payload, in byte order |
|---|---:|---|
| EXPLORE | 1 | 16-byte action key; `u32 tileIndex`; `u16 ruleVersion=0`. **Synthetic, ephemeral test rule only.** |
| SUBSCRIBE | 2 | `u8 count` (0–64); `count × u16 chunkId`, unique 0–255. Replaces full subscription set. |
| RESYNC | 3 | `u16 chunkId`; requires current subscription. |
| PRODUCTION_MUTATION | 4 | Reserved; always `PRODUCTION_DISABLED` until M3 durable path. |
| HELLO | 16 | `u8 synthetic schoolSlot`; `u8 viewFormat=1`. Identity is server derived. |
| ACK | 17 | 16-byte key; `u8 status`; `u8 reason`; `u16 chunkId`; `u64 school-view revision`. |
| SNAPSHOT | 18 | `u16 chunkId`; `u64 school-view revision`; 8192 projected mask bytes; 512 own-school fog bytes. Total frame **8726 bytes**. |
| DELTA | 19 | `u16 chunkId`; `u64 baseRevision`; `u64 nextRevision`; `u16 localIndex`; `u16 projected mask`; `u8 discovered`. Exactly one record; total frame **35 bytes**. |
| ERROR | 20 | `u8 reason`. No private state in error text. |

ACK statuses: 1 `TEST_APPLIED`, 2 `TEST_NO_CHANGE`, 3 `REJECTED`. There is intentionally **no durable committed-success status** in M2. Reason codes: 0 none, 1 invalid frame, 2 invalid command, 3 rate limited, 4 idempotency conflict, 5 queue full, 6 not subscribed, 7 production disabled, 8 internal. ACK is private to the actor. M2 keys are 128 bit; the ephemeral store scopes them to actor within the single synthetic campaign. M3 must add campaign to the durable key and atomically store results with world and ledger changes.

The server projects only the authenticated school bit and that school's fog. It sends no other school bit, metadata or public overview. Revisions are per school and chunk, so activity hidden from a school does not advance its view revision. On subscription, a snapshot is queued before subsequent deltas; stale queued snapshots/deltas are discarded when the subscription generation changes. Client applies a delta only when `baseRevision` equals its stored revision and `nextRevision=baseRevision+1`; duplicates are ignored and gaps request RESYNC. Reconnect authenticates again and obtains fresh snapshots. M2 does not replay missed deltas or retain state across server restart.

## M2.6 experimental transport version 2

The experimental branch keeps version 1 as the default. A client opts in by sending a **version-2 SUBSCRIBE** with the unchanged subscription payload. The server then sends version-2 `DELTA_BATCH` frames for that session's subscribed chunks when a 20 ms or 50 ms batch window is configured. HELLO, SNAPSHOT, ACK, RESYNC, EXPLORE and ERROR retain their version-1 frames. A version-1 subscriber continues to receive version-1 single-record DELTAs. Version-2 frames of other kinds and version-1 `DELTA_BATCH` frames are rejected. An older server rejects version-2 SUBSCRIBE, so deployment would require capability negotiation or explicit client rollback before production use.

`DELTA_BATCH` is kind 21. Its payload is `u16 chunkId`, `u64 baseRevision`, `u16 count` (1–256), then exactly `count` ordered records of `u16 localIndex`, `u16 projectedMask`, `u8 discovered`. Record `i` advances the school/chunk view from `baseRevision+i` to `baseRevision+i+1`. The encoder retains repeated updates to one tile and never merges records. Maximum frame length is 1304 bytes. A client validates every record and the school bit before applying any record; duplicate or overlapping prefixes are skipped, and a revision gap requests a version-1 RESYNC followed by a fresh snapshot. Switching subscription versions, resync, unsubscribe and disconnect invalidate pending batches. Per-session pending records are capped at 1024 and each outgoing frame at 256 records; the existing 128-frame/1-MiB outbound limit still applies. ACKs bypass batching.

This is a test-only protocol candidate. Its full-wire compatibility and network behavior require further review before replacing the M2 default.

## M3.5 durable fixture over default version 1

The M3.5 test gateway keeps the version-1 frame layout and golden bytes. Synthetic `EXPLORE` uses the existing 16-byte idempotency key, `ruleVersion=0`, a server-bound fixture identity and an explicitly configured `fixture-credit` cost. This is a test rule, not approved gameplay. The server serializes by sector and commits the PostgreSQL wallet debit, world effect, command result and outbox event before a `TEST_APPLIED` ACK. Repeated equal requests return the stored ACK result, including across restart; a key reused with changed payload gets `IDEMPOTENCY_CONFLICT`. Production mutation frames remain disabled.

The ACK's revision is the authenticated school's **chunk view revision**, not the global world revision. An outbox event advances that same school/chunk revision once and publishes a version-1 DELTA only to matching subscribers. A reconnect, explicit RESYNC or observed revision gap loads a school-filtered PostgreSQL snapshot. ACK delivery does not depend on viewport delta delivery; clients still use revision checks and resync to reach final state. A postcommit transport failure closes the session so retry can obtain the committed result, rather than sending a false rejection. Version-2 batching remains isolated on `experiment/m2.6-batching`; the M3.5 gateway does not enable it.

## Golden frames

These lowercase hex strings include the CRC. Their tests are in `tests/m2-protocol.test.ts`.

| Frame | Exact hex |
|---|---|
| EXPLORE tile 999999, key `00..0f`, rule 0 | `5232010116000000000102030405060708090a0b0c0d0e0f3f420f0000004cefb947` |
| SUBSCRIBE chunks 0,255 | `5232010205000000020000ff008388b8f8` |
| RESYNC chunk 255 | `5232010302000000ff002d90027d` |
| ACK test-applied, chunk 255, view revision 1, key `00..0f` | `523201111c000000000102030405060708090a0b0c0d0e0f0100ff0001000000000000002f52b3db` |
| DELTA chunk 255, revision 0→1, local 2599, bit 15, discovered | `5232011317000000ff0000000000000000000100000000000000270a008001f2b0f57c` |

## Limits and next version

M2 accepts at most 64 chunks per connection, holds at most 128 outbound frames or 1 MiB per connection, and disconnects a slow client on overflow. A per-session token bucket starts at 20 frames and refills at 10/s. These are **M2 test limits**, not approved production quotas. M1's earlier 256-subscription proposal was narrowed to 64 for bounded snapshot fanout. World and network format versions advance independently. M3 must define durable command envelope, campaign/rule identity, transaction-backed idempotency and committed ACK semantics without reusing the M2 test status.

## Reward preparation command boundary — 2026-10-13

Binary protocol v1 is unchanged. shared/rewards/commands.ts defines an internal JSON fixture DTO (UUID key, use_unistop/open_chest, targetId, fixture-rewards-v1) for direct service/demo tests only. It is not a network opcode or public endpoint. Binding identity comes from the server, not the DTO; unknown price/resource/school fields are rejected. Actor-private receipts contain requested command, status/reason, fixed or persisted sampled reward, server processing time and next availability. Preparation outbox storage has no public relay. Live transport/projection remains separately gated.

## 2026-10-14 local playable bootstrap/account integration

Binary protocolv1 is unchanged. The isolated school-play dev HTTP server exposes GET /api/fixture/bootstrap (fixtureOnly=true,version1,websocketPort and validated human players[token,label,schoolName,slot,home{x,z}]); GET /api/fixture/me, /api/fixture/receipts and /api/fixture/bots require a synthetic bearer token and return only own actor/profile/receipts or own-school bot aggregates. Tokens are local synthetic selectors, not production auth. Old play:local remains compatible through a404-only legacy bootstrap fallback. See shared/integration/devSession.ts and the increment report; no new gameplay command or inventory push protocol is enabled.

## 2026-10-14 private synthetic reward HTTP contract

Binaryv1 unchanged. School-play GET /api/fixture/me adds inventory{credits,crystals,treasureMaps,keys}; GET /api/fixture/rewards lists own synthetic discoveries/status; POST accepts exact RewardPreparationCommand(key UUID,kind,targetId,ruleVersion fixture-rewards-v1),<=4096-byte application/json, synthetic auth/same-origin/rate checks. Reply200 has fixtureOnly/committed-or-replay/receipt; logical rejections persist in receipt, payload conflicts409. GET /api/fixture/rewards/events?after=<int64 decimal> returns max50 own stable events and nextCursor; consumers track cursor/dedup per actor. No mark-delivered, SSE or new WebSocket opcode is introduced. Reward and explore keys share campaign/actor namespace; fixed fixture point rewards map to exploration fixture-credit only. See shared/rewards/playable.ts, client/src/rewardClient.ts and increment02 report. Normal gameplay UI not yet mounted.

## Live map batches — 2026-10-22

The browser opts in with `SUBSCRIBE_LIVE` (kind 5, same chunk list as `SUBSCRIBE`). Legacy subscriptions retain their existing frames. Authentication, mutation validation, committed ACKs and Partner API v1 are unchanged. Timings are in `GAME_CONFIG.realtime`: school batches 100 ms; rival/public batches every 12 seconds; shared map-object reads every 500 ms; HTTP world polling falls back to 60 seconds.

- `SCHOOL_PATCH` (24): caller-school mask and fog changes only. One snapshot read/diff per dirty school/chunk is shared across viewers; repeat changes to a tile collapse to its final state. ACKs bypass batching. Own terrain colors use this immediate layer instead of waiting for the public layer.
- `PUBLIC_PATCH` (23): active Knowledge membership only, with no fog. Only subscribed chunks are streamed. Repeated writes collapse by tile within the 12-second batch; removals use mask zero.
- Both patches contain `u16 chunkId`, `u64 baseRevision`, `u64 nextRevision`, `u16 count`, followed by up to 4096 unique tiles (`u16 localIndex`, `u16 mask`, plus a boolean byte for school fog). All integers are little endian. Coalesced revisions may jump; duplicates are ignored, missing bases request resync, and a snapshot already inside the revision range may accept the final-state patch. Validate the whole packet before applying. Dense patches or lost server history fall back to a shared snapshot. Subscription generations discard stale queued frames; reconnect starts with snapshots.
- `MAP_STATE` (25): JSON batches with `reset`, changed `objects`, `removed` IDs and public beacon ownership. UniStop and beacon changes reach the old/new owning schools on the fast object tick; unrelated schools receive the accumulated latest state every 12 seconds. Initial/reset snapshots are immediate. There are no wallets, private chests, puzzle state or fog in this feed. The client updates existing scene objects and beams without resetting its camera.

The server polls map objects once per campaign, not once per player, and encodes outgoing batches once per school. UniStop contact synchronization is coalesced after committed Knowledge changes. Idle map feeds send no repeated state. Buff/gameplay, auth and rewards still use their existing server-authoritative transactions; this stream conveys committed presentation state only.

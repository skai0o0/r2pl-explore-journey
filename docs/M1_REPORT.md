# M1 review report — Million-Cell World Foundation

Date: 2026-10-09. Status: **implemented for owner review; M2 not authorized**.

## Implementation

| Backlog item | Result |
|---|---|
| M1-01 | Greenfield strict TypeScript/Vite workspace and exact npm lock; pinned Colyseus 0.18 core/SDK/WS transport, Schema 5, Three.js 0.186.1. Loopback request and binary message smoke test passes. |
| M1-02 | Immutable 16-slot `SchoolRegistry` rejects duplicate IDs/slots and remapping on restore. Executable code uses synthetic IDs only. The V1 0–7 proposal is still awaiting owner confirmation. |
| M1-03 | Pure row-major tile, chunk and sector addressing with exhaustive one-million-index test and edge validation. |
| M1-04 | One dense `Uint16Array` for school presence; optional per-tile/per-school opaque metadata is sparse. |
| M1-05 | Lazily allocated per-school, per-chunk fog bitsets; reveal only sets a bit and has no gameplay trigger or cost. |
| M1-06 | Deterministic version 1 little-endian 8,192-byte knowledge and 512-byte fog chunk payloads, CRC-32 checksums, uint64 revisions and zero edge padding. Golden CRC fixtures and corrupt-input tests pass. |
| M1-07 | Deep-copy in-memory repository and full 256-chunk snapshot/restore. Registry, checksum, padding, unknown mask bits and metadata/presence mismatch are checked before returned state is used. |
| M1-08 | Synthetic Three.js overview and local view share one 1,000×1,000 RGBA texture and one plane; two scissored draws, no per-tile Mesh or DOM nodes. |
| M1-09 | Measurement scripts and this gate report. |

M1 follows ADR-003 and M1's ADR-004 mapping. ADR-011 stays open for M3 benchmarks. No Redis, distributed sectors, production gameplay command, economy ledger or database writes were added. Original and revised gacha probability values remain traceable in `OWNER_REQUIREMENTS.md`, `GAME_SPEC.md` and `SPEC_CONFLICTS.md`; M1 code does not consume or normalize them.

## Verification

- `npm ci`: pass from exact lockfile after stopping the local Vite process that held a native module open; 114 packages installed, zero audit vulnerabilities.
- `npm run typecheck`: pass (strict TypeScript).
- `npm run lint`: pass, no diagnostics.
- `npm test`: 7/7 pass after clean install, including exhaustive coordinate round trips, seeded 10,000-mutation all-slot snapshot property fixture, binary golden/corruption cases, full restore, sector routing, and Colyseus loopback request/binary exchange. The loopback test needs local socket access outside the default network sandbox.
- `npm run build:client`: pass. `npm run bench:world` and `npm run report:size`: pass.
- Edge browser visual check: both views rendered; no console errors in the observed tab.
- V1 repository remained read-only; no production data was modified.

## Memory and serialization benchmark

Windows x64, Node 24.19.0, Intel Core i5-13400F (16 logical CPUs), 34,164,097,024 bytes installed RAM; `--expose-gc`. Fixture: 1,000,000 cells, 50,000 deterministic presence writes, two fog reveals, one four-byte metadata payload. Timings are process-local and include checksum/validation; initialization allocates a zero-filled typed array lazily, so its timing is not a full page-touch benchmark.

| Measure | Result |
|---|---:|
| Dense mask | 2,000,000 bytes exact |
| Fog resident in fixture | 2 chunks × 512 = 1,024 bytes |
| Metadata payload | 4 bytes, excluding Map/object overhead |
| Full padded snapshot payload | 2,098,180 bytes (256 mask chunks + 2 fog chunks + metadata payload) |
| Empty world creation | 0.007 ms p50, 0.015 ms p95, 20 samples |
| Full snapshot serialization | 14.758 ms p50, 17.240 ms p95, 15 samples |
| Full snapshot restore | 16.745 ms p50, 19.083 ms p95, 10 samples |

After forced GC, `arrayBuffers` was 138,495 bytes at baseline and 2,138,495 bytes with one empty world, matching the 2 MB mask exactly. Process RSS was 68.26 MB baseline and 68.43 MB after allocation; RSS is allocator/OS-dependent and is **not** a reliable marginal mask size. The populated fixture reached 4.14 MB `arrayBuffers` because timed allocations had been made; the snapshot phase reached 23.29 MB due to repeated snapshot buffers retained/reused by the runtime. These process numbers are workload observations, not a per-world capacity estimate. `npm run bench:world` emits the full JSON for repeatability.

## Visual fixture and size

Edge on the same Windows desktop, default browser viewport, synthetic two-school texture, observed 240-frame rolling sample: about 10.0 ms p50 and 14.9 ms p95 frame interval, two draw calls/frame, one geometry, one texture, 4,000,000 texture payload bytes. Browser heap was about 66 MB in the observed sample and varies with GC. WebGL does not expose actual driver GPU allocation; the 4 MB value is upload payload, not total GPU memory. This fixture does not exercise real gameplay visibility, camera movement, animations, mobile hardware or hotspot fanout.

After `npm run build:client` (which empties the prior output directory):

| Category | Bytes |
|---|---:|
| First-party runtime source (11 TS/CSS files) | 32,669 |
| Tests (2 files) | 10,868 |
| Scripts (2 files) | 5,457 |
| Built client, 3 files | 534,455 raw / 133,480 gzip / 109,279 Brotli |

The JS file alone is 533,390 bytes raw, mostly Three.js and world fixture code; Vite flags the raw >500 KB chunk. This is a development fixture, not an agreed production download target.

## Deviations and known issues

- **Approved gate adjustment:** M1-02 uses generic immutable slots and synthetic 0/15 identifiers instead of persisting the proposed V1 roster. Production mapping confirmation remains required before campaign data.
- The `SectorAuthority` interface has only inert chunk reads and presence writes. Command queues, durable ordering and subscriptions are M2/M3 work.
- M1 snapshot records are in-memory objects with binary payloads; no finalized network envelope, file format or SQL schema is claimed.
- Reconnect/resubscription behavior was not tested because M1 has no session protocol. M2 must test it with its gateway.
- Browser GPU allocation and mobile frame times are unmeasured. Later rendering must enforce visibility filtering; the M1 synthetic fixture is not a public map policy.
- This local V2 folder has no remote repository configured. The lockfile and commands permit clean-install verification, but remote checkout/CI has not been exercised.

## M2 readiness and stop gate

The world representation, addressing, codec, in-memory repository, sector boundary and compatible transport package set are ready as M2 inputs. M2 should begin only after owner review and explicit authorization. M2 can test synthetic/ephemeral realtime convergence without settling production school IDs or unrelated gameplay/reward rules. M2 still needs a visibility projection, bounded subscriptions/queues, revisioned network envelopes, reconnect tests and balanced/hotspot load tests. Production success acknowledgements remain blocked until M3 provides atomic durable world/ledger/idempotency/outbox commits and ADR-011 is selected from measurements.

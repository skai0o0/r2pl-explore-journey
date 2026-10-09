# Performance and code budgets — M1 baseline, M2 evidence and later targets

Targets are test obligations, not measured V2 properties. Publish workload, hardware, software versions, client viewport, school count, traffic distribution and sample counts with every result.

M1 local measurements are recorded in `M1_REPORT.md`. The exact dense mask is 2,000,000 bytes; two allocated fog chunks are 1,024 bytes; the complete padded mask snapshot plus two fog chunks and four metadata bytes is 2,098,180 payload bytes. On the recorded desktop, full-world serialization measured 14.758 ms p50 / 17.240 ms p95 (15 samples) and restoration 16.745 ms p50 / 19.083 ms p95 (10 samples). These are local in-memory measurements with no network, database, concurrency or durability claim. The Edge synthetic visual fixture measured about 10 ms p50 / 14.9 ms p95 frame intervals in a 240-frame rolling sample, two draw calls, one geometry, one texture and a 4 MB RGBA payload. Actual GPU allocation is not exposed by WebGL; mobile and representative gameplay views remain unmeasured.

| Area | Proposed target / gate | Measurement method |
|---|---|---|
| Core mask | Exactly 2,000,000 bytes for 1,000,000 uint16 cells; no million Tile objects | `ArrayBuffer.byteLength`, heap and allocation profile after initialization |
| Fog storage | 125,000 bytes/school flat; 131,072 bytes/school when 256 padded 512-byte chunks are resident | Exact payload count for 8 and 16 schools; sparse metadata measured separately |
| Chunk format | 8192 bytes mask + 512 bytes per-school fog payload; zero-padded final edge; ≤16 KiB framed snapshot | Golden fixture, length/checksum validation and transfer capture |
| M1 correctness | One million cells initialize, mutate, serialize and restore exactly, including bit 15 and 40×40 edge; deterministic bytes | Repeat property/fixture run and compare hashes/state |
| Browser renderer | No million independent Mesh/DOM/animation objects; target 60 fps on agreed desktop and 30 fps on agreed mobile test device under representative views | Browser frame-time p50/p95, GPU memory and draw calls at overview and hotspot |
| Network | Viewport-only subscriptions; ≤1 KiB command and ≤64 KiB delta before exception review; bounded per-client queue | Bytes/client/s p50/p95, frame sizes and resync count under load |
| Reliability | Zero duplicate business effects for identical commands; zero lost acknowledged transactions | Concurrent retry, crash/restart and PostgreSQL reconciliation tests |
| Scale (M7) | 100, 1,000, 5,000, then 10,000 connections; sustained 1,000 actions/s; bursts 3–5× | Distributed generators, balanced and single-sector hotspot workloads |
| Latency (M7) | p95 committed action ack <300 ms and visible convergence <500 ms in agreed environment | End-to-end client timestamps plus queue, DB and broadcast phases; p50/p95/p99 |
| Database write strategy (M3) | Select ADR-011 only from measured candidates; no lost committed revision or ledger effect | WAL/bytes per mutation, chunk-row lock wait, deadlocks/retries, snapshot lag, replay/recovery time |
| First-party source | Approximately 1 MB soft budget, excluding tests/docs/assets/generated/lockfiles/dependencies | Automated category report; investigate growth, never sacrifice correctness for size |
| Bundle and memory | M2 has a fixture baseline; agree concrete download/runtime budgets from target devices in M4 | Vite build size, compressed transfer, heap/GPU trace and asset size separately |

## V1 evidence, with limits

V1 `docs/world-benchmark.md` reports 10k mutation encode median 0.074 ms, decode 0.131 ms, 64×64 chunk serialize median 0.086 ms, deserialize 0.153 ms on one workstation. It reports 2 MB mask, ~1 MB padded fog for eight schools, and a 1 MB legacy owner buffer. Its 100-client cache simulation allocates ~190 MB of full-world client arrays. These are local microbenchmarks, not server connection, SQL, browser or GPU capacity. V2 benchmarks start from new code and a recorded environment.

## Benchmark gates

M1 records memory, initialization, serialize/restore and edge/fuzz correctness. Network stages begin in **M2**; see `ROADMAP.md` for the 10/100/500 → 1,000 → 5,000/10,000 client progression and proposed action rates. Every stage has balanced and hotspot workloads. Hotspot means at least 70% of action load targets one sector, with separate same-chunk and same-tile conflict cases; balanced traffic covers all 16 sectors. Bursts run at 3× a stable stage for M2/M3 and 3–5× at M7.

At each stage, record per-command receive/decode, authentication, validation, routing, queue wait, execution, database lock/commit where applicable, ack and visible convergence as p50/p95/p99 plus errors/timeouts. Record per-sector queue depth p95/max and time to drain after a burst; an unbounded or non-draining queue fails the gate even if throughput appears high. Record intended versus actual fanout recipients, outbound bytes/action and bytes/client/s p50/p95, snapshot/delta sizes, dropped/resynced clients and hidden-data filter violations. At M3 add lock-wait p50/p95/p99, row conflicts, deadlocks, retries, WAL bytes and data bytes per action, checkpoint/materialization lag and recovery replay duration. Include CPU, heap/RSS, event-loop lag, database pool saturation and generator utilization so bottlenecks are attributable.

M2 uses an ephemeral adapter: its measurements validate command processing and convergence only. M3 records transaction latency and crash/retry invariants on real PostgreSQL; no production success ack exists before that gate. M4 measures browser frame time, GPU and bundles. M7 tests distributed throughput and failure recovery. A stage fails on duplicate business effects, lost acknowledged transactions, client divergence, hidden-data leaks or generator saturation. A queue must return to pre-burst depth within 30 seconds at the proposed M2/M3 rates. Latency and byte budgets that lack an agreed device/environment remain measured baselines rather than presumed pass values. Load generators must be profiled and distributed when necessary.

### M2 measured gate and remaining work

`REALTIME_CAPACITY.md` and `docs/benchmarks/M2_*.json` record six 100/500/1,000-client balanced/hotspot runs. All converged with zero observed resyncs/errors and no unbounded sector queue; the 1,000-client hotspot achieved 180.8 rather than scheduled 250 actions/s and client ack p95 rose to 2171 ms. That is a failed **capacity** stage despite a passed **convergence/visibility** stage. The five-second single-host generator cannot establish sustained server capacity. A 3× burst was not run: first isolate generator/server and investigate hotspot fanout. Do not advance a capacity claim from this result; repeat burst, socket-buffer and visible-convergence measurements before any 5,000-client stage.

# M2.5 realtime hotspot investigation

**Status:** isolated-process measurements complete for the listed synthetic workloads; higher-capacity approval remains open. The 2026-10-09 M2 same-process result (1,000 clients, 70% hotspot, 250 requested actions/s) achieved 180.8 actions/s and client ACK p95 2171 ms. The follow-up separated the load generator and game server into distinct Node.js processes on the **same Windows desktop**; it did not simulate separate hosts or a production network.

## Instrumentation and method

`scripts/bench-realtime.ts --isolated=true` starts `bench-realtime-server.ts` as a child process with independent CPU/RSS metrics. Server metrics now separate delta encoding, fanout candidate count, fanout enqueue time, socket buffered bytes, command receive-to-ACK enqueue, ACK queue-to-socket send, delta queue-to-socket send and sector work. The generator measures send-to-ACK receive, 20 sampled actors' send-to-own-visible-delta receive, per-client payload bytes, final full subscribed mask/fog equality and resync/error counts. For each case the clients use synthetic slots 0 and 15 and one subscribed chunk. Hotspot allocates at least 70% of actions to one sector/chunk. All successful cases had exact final authorized projection convergence and zero observed resync/client errors.

| 1,000 clients | Requested / achieved actions/s | Client ACK p95 / p99 | Server receive→ACK enqueue p95 | Fanout recipients | Server CPU / generator CPU | Result |
|---|---:|---:|---:|---:|---:|---|
| Balanced, scan, 20 s | 250 / 249.9 | 4.7 / 9.7 ms | 1.6 ms | 256,000 | 4.8 / 6.1 CPU-s | Converged |
| Hotspot, scan, 20 s | 250 / 250.1 | 38.4 / 61.7 ms | 5.9 ms | 1,182,338 | 15.9 / 19.4 CPU-s | Converged |
| Hotspot, indexed, 20 s | 250 / 249.9 | 28.6 / 60.4 ms | 5.8 ms | 1,182,338 | 15.3 / 18.9 CPU-s | Converged |
| Balanced, scan, 5 s burst | 750 / 749.2 | 37.6 / 58.6 ms | 1.3 ms | 234,378 | 4.7 / 6.6 CPU-s | Converged |
| Hotspot, scan, 5 s burst | 750 requested | 7,851 ms p95 among received ACKs | Not complete | — | — | **Failed:** 3,538/3,750 ACKs before 20 s timeout |
| Hotspot, indexed, 5 s burst | 750 requested | 7,686 ms p95 among received ACKs | Not complete | — | — | **Failed:** 3,540/3,750 ACKs before 20 s timeout |

Raw successful results and bounded failure artifacts are `docs/benchmarks/M25_*.json`. CPU-s means CPU time accumulated across cores for the full run, including setup and verification, not percent utilization. Client ACK and server phase percentiles cannot be subtracted as if they belonged to the same exact command. One later 5-second hotspot scan sampled **34 eligible own-delta arrivals**, all observed, with p95 send-to-visible-delta 16.3 ms and ACK p95 15.9 ms; this is a small, separate timing sample, not the 20-second population. At 20 seconds the scan path's server delta queue-to-send p95 was 6.6 ms, delta encode p95 approximately 0.01 ms, fanout enqueue p95 0.62 ms, and sampled socket buffered amount p95 was zero. This does not rule out kernel/socket write pressure.

## Profile and cause assessment

The raw Node CPU profile is in `docs/benchmarks/profiles/`, with `M25_cpu_profile_summary.json`. In the profiled five-second hotspot scan run, native `writev` accounted for **38.75% of sampled self time**; `OutboundQueue.enqueue` and `#drain` together about **6.2%**. Idle accounted for 21.75%. This profile includes profiling overhead and should not be compared directly to unprofiled throughput. Encoding was small by both profile and phase histogram. The server's school projection is created for initial snapshots, then a single encoded delta is shared across recipients; snapshot creation did not dominate the action phase. The sender side transmits a large number of individual frames: 1.18 million recipient deliveries for 4,617 applied changes in the sustained hotspot.

The large M2 same-process client ACK gap diminished after generator/server separation: both 20-second isolated hotspot variants sustained 250 actions/s with sub-40-ms ACK p95. This supports **shared-process generator/event-loop contention** as a major contributor to the original 2171-ms p95, while the 3× hotspot failures show an independent fanout/socket ceiling. The exact split between kernel write cost, Colyseus framing, generator receive/parse work and host CPU contention still needs separate-host or network testing. No 10,000-CCU claim follows.

## Optimization comparison

The optional indexed fanout path changes only server subscription lookup. The school/chunk index preserved filtering and ordered revisions in regression tests. In the sustained hotspot it inspected only subscribed same-school candidates rather than all 1,000 sessions, and reduced ACK p95 from 38.4 to 28.6 ms in one matched pair. Its 5-second unprofiled pair showed mixed results, so the improvement is **not** established as repeatable. Both indexed and scan failed the 750-actions/s hotspot burst; neither changes outbound recipient count. The default remains scan pending replicated measurements.

`M25_batching_model.json` uses the exact deterministic 20-second hotspot action/subscription schedule and reproduces the measured 4,617 applied actions and 1,182,338 recipients. An **idealized**, versioned 20-ms ordered batch could reduce individual delta frames by 40.75% and modeled delta payload bytes by 46.78%; it would add up to 20 ms of intentional delay, and the model does not include WebSocket framing or implementation CPU. This is a candidate, **not a measured optimization**. Current M2 `DELTA` carries one revision and one record; dropping intermediate revisions or merging same-tile records would create a gap and violate client convergence. Safe batching/coalescing requires a versioned multi-record contract, a contiguous revision test suite and school-specific projection checks. No wire change was made in M2.5.

## Remaining gates

Repeat multiple independent runs, add a separate-host generator, capture full socket send/receive timing and sustained 3× hotspot behavior, and test a versioned batch prototype before adopting it. The failed hotspot burst must remain visible in capacity planning. Redis and distributed sector authority are not justified by these measurements. C-08 production visibility remains pending owner approval; every optimization must preserve current synthetic school isolation and monotonic per-school chunk revisions.

# M2 realtime capacity and bottlenecks

These are **synthetic loopback measurements**, not a production connection or durability rating. All six complete result files are in `docs/benchmarks/M2_*.json`; the generator and server shared one Node.js process and one Windows host (Node 24.19.0, i5-13400F, 16 logical CPUs, 32 GiB RAM). Each client authenticated with a synthetic token, subscribed to one 64×64 chunk, and held a single-school replica. Each five-second action schedule sent unique test EXPLORE commands. Balanced actions spanned 16 sectors; hotspot placed 70% of actions in one sector/chunk. Two synthetic schools used slots 0 and 15. Counts below include only successfully acknowledged test actions. All cases ended with exact per-client mask and fog comparison against the server projection, zero resyncs and zero client errors.

| Clients / distribution | Requested / achieved actions/s | Client ack p50 / p95 / p99 ms | Fanout recipients | Outbound payload MB | RSS MiB | Event-loop lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| 100 balanced | 20 / 20.1 | 2.4 / 6.1 / 7.9 | 628 | 0.90 | 128 | 32 |
| 100 hotspot | 20 / 20.1 | 3.5 / 12.3 / 17.1 | 2,646 | 0.97 | 128 | 33 |
| 500 balanced | 100 / 99.9 | 4.0 / 16.7 / 44.8 | 15,628 | 4.94 | 270 | 32 |
| 500 hotspot | 100 / 99.5 | 6.8 / 37.9 / 62.8 | 66,466 | 6.72 | 275 | 33 |
| 1,000 balanced | 250 / 250.1 | 7.1 / 62.4 / 89.5 | 78,126 | 11.52 | 321 | 32 |
| 1,000 hotspot | 250 / **180.8** | **1015 / 2171 / 2382** | **332,715** | 20.44 | 322 | **259** |

The 1,000-client hotspot **missed** its 250 actions/s requested rate and showed severe client-observed ack latency. Its sector queue depth p95/max was 1/1 and sector wait p95 0.022 ms, while server command-to-enqueued-ack p95 was 6.9 ms and client ack p95 was 2171 ms. This points to same-process event-loop, socket fanout and/or load-generator contention after command execution; it is an inference, not a proven production bottleneck. At that stage one action reached many interested recipients (332,715 recipient deliveries across 1,250 actions). No queue overflow occurred. The action schedule took 6.91 seconds to finish all acknowledgements. Connection and disconnection rates, queue phase histograms, bytes/client distribution and CPU/RSS are in the JSON files.

**Measurement limits:** the generator shares server CPU and event loop, so server-only capacity and distributed network behavior cannot be isolated; WebSocket/Colyseus framing bytes are excluded from payload counts; traffic lasted five seconds and includes no database, crash, real authentication or mobile browser; per-client convergence scanning adds work after the action window. `eventLoopLagP95Ms` covers the full run, including snapshot setup and convergence verification. The small-sample 100-client p99 and short-run rates are indicative only. The exact 100-balanced run was refreshed after correcting teardown timing; recorded numbers may vary by host load.

**Next investigation, before any capacity claim:** separate generators from the server, profile CPU in the 1,000-client hotspot, compare fanout group/index lookup and batched/coalesced deltas, measure socket buffering and visible convergence latency, then repeat sustained and burst stages. Preserve per-school projection and ordered per-client revision semantics. No Redis or distributed sector processes are justified by this single-host result. M3 may proceed after owner review for transactional durability work, but this hotspot limit should remain a performance gate before higher-rate readiness.

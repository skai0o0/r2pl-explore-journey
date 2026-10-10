# M3 Durable Persistence & Economy — PostgreSQL validation

**Status, 2026-10-10:** the owner technically accepted M3's tested synthetic durability foundation and approved ADR-011 full-chunk transactional writes as the revisitable baseline. Production gameplay mutations remain disabled; M3.5 is the authorized integration gate, and M4 is unauthorized.

## Environment and isolation

Docker, WSL and an installed PostgreSQL server were unavailable. PostgreSQL **16.15** Windows binaries were unpacked from EDB's archive into the Git-ignored .m3-local-db/ directory. The test cluster used UTF-8, data checksums, fsync=on, full_page_writes=on, and synchronous_commit=on; it bound only to 127.0.0.1:55432 and was not registered as a Windows service. R2PL_TEST_DATABASE_URL targeted its empty r2pl_test database. The V1 Supabase project was never connected or modified.

Client, load generator and database shared one Windows desktop: Intel i5-13400F, 16 logical CPUs, Node 24.19.0. These short synthetic fixture runs measure this transaction implementation and database, **not** 1,000-client network capacity or a production hardware limit. The database was otherwise isolated; WAL byte differences are still database-wide counters and may include background activity.

## Implementation and correctness

The private r2pl_v2 migration creates versioned campaigns, immutable 16-slot school assignments, fixture wallets and ledger, idempotency records with payload hashes, chunk heads and checksummed mask/fog checkpoints, ordered mutation records and a token-leased outbox. The migration runner executes in one transaction under an advisory lock and checks its SHA-256 on repeat runs. No production roster, cost, reward or visibility rule is seeded.

A final cross-worktree regression exposed a Windows checkout portability issue: Git could materialize the same SQL as LF or CRLF, causing a false checksum mismatch against the already applied migration. The migration runner now normalizes CRLF to LF **for hashing only**. The SQL and stored LF checksum are unchanged, and the disposable database's repeated migration passed from both worktrees after this correction.

M3TestMutationService performs the fixture world effect, wallet debit, ledger entry, saved command result and outbox event in one transaction with synchronous_commit=on. A committed-success result is returned only after COMMIT. Identical retries return the saved result; a changed payload with the same key conflicts. The M2 production mutation path remains fail-closed and is not wired to this fixture service.

The full suite passed: **20 tests, 0 failures, 0 skips**. The PostgreSQL integration case ran in about 1.9 seconds. It covered:

| Required invariant | Observed result |
|---|---|
| Migration initialization and repeatability | First and second invocation succeeded; migration checksum matched. |
| Atomic effect, debit, ledger, result and outbox | Reconciliation and row counts matched for both write strategies. |
| Concurrent same wallet/tile/chunk | Same-tile calls returned no-change after the first effect; 30 distinct same-chunk effects serialized without loss. |
| Idempotent retries and conflicting payload | 12 concurrent repeats returned the original revision/balance; changed payload raised IdempotencyConflict. |
| Precommit failure and lost postcommit ACK | Precommit fault rolled back wallet and claim; postcommit fault was replayed from a new Node process with the same result. |
| Exact world recovery and school fog | A new Node process reconstructed the same revision and SHA-256 mask/fog bytes; slot 15 could not see slot 0's unrelated discoveries. |
| Concurrent checkpoint and recovery | A held chunk lock released materialization and ten competing writes; final revision 42 and complete mask/fog survived a further checkpoint and fresh-process read. |
| Outbox lease and duplicate publication | Release and expiry both allowed reclaim with a new token; stale tokens could not mark delivery; a simulated lost relay ACK produced the same event ID/payload twice for consumer deduplication. |

The outbox is intentionally at least once. It has no external publisher in M3; downstream consumers must deduplicate its stable event ID.

## ADR-011 benchmark

Both candidates ran against the same PostgreSQL instance and the same explicit fixture cost, tile sequence, school and wallet logic. Balanced traffic covered 16 sectors; hotspot traffic targeted one chunk. The benchmark prewarmed its connection pool. It ran **200 actions at 16 concurrent requests**, then **1,000 actions at 32 and 64 concurrent requests**. Each 1,000-action stage was repeated in reversed strategy/workload order. All 20 measured cases applied every requested operation, with **0 failed operations, 0 retries and 0 new deadlocks**.

The table gives ranges across the two independent 1,000-action orders. Transaction p95 and head-lock p95 are in milliseconds; WAL is approximate bytes per applied action. The 200-action baseline is in the JSON artifact.

| Concurrency / workload | Strategy | Applied actions/s | Transaction p95 | Head-lock p95 | WAL/action |
|---|---|---:|---:|---:|---:|
| 32 / balanced | Full chunk | 683–1,177 | 33–54 | 12–19 | 3,061–3,086 |
| 32 / balanced | Mutation log | 599–648 | 53–83 | 21–23 | 2,685–2,710 |
| 32 / hotspot | Full chunk | 268–421 | 76–121 | 66–98 | 3,049–3,054 |
| 32 / hotspot | Mutation log | 183–221 | 158–196 | 133–168 | 2,694–2,794 |
| 64 / balanced | Full chunk | 565–667 | 121–136 | 58–62 | 3,189–3,207 |
| 64 / balanced | Mutation log | 546–612 | 109–124 | 57–66 | 2,814–2,829 |
| 64 / hotspot | Full chunk | 165–243 | 258–482 | 210–401 | 3,180–3,653 |
| 64 / hotspot | Mutation log | 182–195 | 340–354 | 292–310 | 2,706–2,818 |

In 1,000-action balanced cases, log checkpoint materialization cost **34–48 ms** plus **17–20 KB WAL** across 16 chunks. In hotspot cases it cost **5–13 ms** plus **2–8 KB WAL** for one chunk. Before materialization, recovery reads took **18–30 ms** balanced and **3–5 ms** hotspot for the log, versus **7–22 ms** and **1–2 ms** for full chunks. After materialization, log recovery was usually close to the full-chunk read. A log also retains 1,000 mutation rows and needs materializer scheduling, lag monitoring, replay validation and retention policy. Full-chunk writes need no derived checkpoint process.

Windows process samples showed roughly **106 MB**, **192–196 MB**, and **363–369 MB** of aggregate PostgreSQL private bytes at 16, 32 and 64 connection levels. Database action CPU samples ranged from about **0.5–0.9 CPU-seconds** at 200 actions to **2.9–6.2 CPU-seconds** at 1,000 actions, depending on order and contention. These are before/after process sums, not isolated per-query CPU; RSS sums can double-count shared pages. Every raw artifact includes p50/p95/p99 latency, read/write phases, WAL, checkpoint cost, recovery times, process CPU/memory, deadlocks and failures:

- docs/benchmarks/M3_postgres_baseline_200c16.json
- docs/benchmarks/M3_postgres_larger32_1000c32.json
- docs/benchmarks/M3_postgres_reverse32_1000c32.json
- docs/benchmarks/M3_postgres_larger64_1000c64.json
- docs/benchmarks/M3_postgres_reverse64_1000c64.json

## ADR-011 decision and limits

**Select full-chunk transactional writes for the M3 baseline.** Both strategies passed atomicity and recovery tests. The mutation log saved roughly 10–20% WAL in most larger runs, but did not consistently improve throughput or latency under chunk contention. Full chunks avoid an operational checkpoint/replay dependency and yielded faster direct recovery. The choice is based on correctness, lock behavior, write pressure, recovery and operational complexity together. Keep the mutation-log implementation as a test candidate; revisit only after representative denser worlds, sustained load and database-host measurements justify the added complexity.

The hot chunk remains a serialization limit in either strategy: at 64 concurrent requests, transaction p95 reached 258–482 ms for full chunks and 340–354 ms for the log. This benchmark does not establish a production ACK target, because no production auth, rules, network clients or publisher were included. The short run also cannot establish long-term WAL, vacuum, storage growth or failover behavior.

## Source, CI and readiness

The V2 CI workflow includes an Ubuntu PostgreSQL 16 service with synthetic credentials. Its remote run awaits owner-provided GitHub repository details. A clean npm install from the lockfile, strict compile, lint, client build and all 20 tests passed locally. The source-size report measured **25 first-party source files / 98,579 bytes**, **6 test files / 46,445 bytes**, and **10 scripts / 47,862 bytes** after the portable migration-checksum fix. The unchanged client bundle is **535,489 bytes raw / 133,880 bytes gzip**. pg and @types/pg are the only M3 package additions.

**M3 technical recommendation:** accept the durable synthetic transaction foundation and ADR-011 full-chunk choice for M3. Production gameplay actions must wait for approved identity, visibility and game rules, plus the owner review gate. **M4 remains unauthorized.**

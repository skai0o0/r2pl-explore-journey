# M3 Durable Persistence & Economy — validation record

**Status on 2026-10-10: implementation prepared; M3 acceptance gate open.** A disposable PostgreSQL connection has been requested from the owner and has not yet been configured. The PostgreSQL integration test and ADR-011 benchmarks have therefore not run. No production gameplay command is enabled, and no durable-success capacity claim is made.

## Implemented scope

- `database/migrations/001_m3_foundation.sql` creates a private `r2pl_v2` schema with campaigns, immutable school slots, nonnegative fixture wallets, command idempotency records, chunk heads/checkpoints, per-school fog, durable mutation records, a signed ledger and outbox. Binary mask/fog lengths and CRC32 values are constrained or checked. No production school roster or gameplay rule is seeded.
- `scripts/migrate-m3.ts` applies the migration under a transaction and advisory lock using `R2PL_TEST_DATABASE_URL`, and checks its SHA-256 on repeat runs. The integration test invokes this exact command. It never auto-connects to the V1 project.
- `M3TestMutationService` performs a fixture world effect, fixture-credit debit, ledger entry, idempotency result and outbox event in one PostgreSQL transaction with `synchronous_commit=on`. It returns a committed success only after `COMMIT`. The same campaign/actor/key and payload replays its saved result; a changed payload conflicts. It has explicit fault hooks for precommit rollback and postcommit lost-ACK retry.
- Both ADR-011 candidates are implemented behind the same fixture contract: a full 8192-byte chunk plus 512-byte fog write, and an append-only ordered mutation with checkpoint materialization. `readAuthoritativeChunk` replays committed mutations from a verified checkpoint and rejects gaps. `materializeChunk` verifies CRC32 and advances mask/fog checkpoint data in one transaction.
- The outbox relay claims pending rows with a finite tokened lease and `SKIP LOCKED`. A stale worker cannot release or mark a newer claim. Delivery uses a stable event ID and remains at least once; consumers must deduplicate. No external publisher is attached.
- CI is prepared with a disposable PostgreSQL 16 service on Ubuntu. The Git remote remains unconfigured pending owner details.

## Validation status

| Gate | Current evidence | State |
|---|---|---|
| TypeScript strict compilation | `npm run typecheck` passed locally | Pass |
| Lint and format | `npm run lint` passed locally | Pass |
| M1/M2/M2.5 regression | `npm test`: 19 passed, 0 failed, PostgreSQL M3 test skipped without `R2PL_TEST_DATABASE_URL` | Pass for non-DB scope |
| PostgreSQL migration and integration | Migration runner and test written; no disposable DB connection yet | **Pending** |
| Precommit rollback and postcommit retry after process restart | Integration assertions written, including concurrent same-key retry | **Pending real DB run** |
| Wallet/ledger/world/outbox reconciliation | Integration assertions written for both strategies, hot-chunk concurrency, cross-school fog | **Pending real DB run** |
| ADR-011 WAL, chunk lock, transaction, materialization and recovery comparison | `scripts/bench-postgres.ts` records balanced/hotspot 200-action stages, with optional higher count | **Pending real DB run and decision** |
| Source/dependency review | 25 first-party source files, 98,579 bytes; 6 test files, 42,302 bytes; 9 scripts, 42,722 bytes. Client bundle remains 535,489 bytes raw / 133,880 bytes gzip. `pg` and `@types/pg` are the only M3 packages added | Pass, repeat before acceptance |

The fixture benchmark uses one client host/process and one database connection pool, with 16 concurrent commands by default. Its results will describe transaction behavior in that environment, not 1,000-client end-to-end capacity. WAL counters are database-wide and must be labeled accordingly if the disposable database hosts other traffic.

## ADR-011 decision gate

ADR-011 is **not selected**. Compare both strategies on the same database and fixture workload using transaction p50/p95/p99, chunk-head lock wait, read/write phases, WAL bytes per action, checkpoint bytes, log growth, materialization duration, recovery read time and deadlocks. Hotspot serial contention is expected for either strategy because both lock a chunk head. The choice must preserve atomic wallet/world/idempotency/outbox commit and exact recovery after restart; a smaller WAL result alone is insufficient.

## Known issues and remaining work

- Obtain a disposable PostgreSQL connection, run migration, integration tests and measured benchmarks, then update this report and ADR-011 with a benchmark-supported decision. Do not use the V1 production Supabase project.
- Run at least one larger contention stage if the 200-action baseline passes; inspect lock timeout, pool saturation and checkpoint lag. Report the database environment and any benchmark failures.
- M3's transaction is an explicit synthetic fixture. Approved gameplay costs, C-08 production visibility, production authentication and rules remain unresolved, so no production action is wired to it.
- The separate M2.5 report records a hotspot burst failure and leaves higher-capacity claims open. M4 requires owner review of both M3 durable correctness and that realtime explanation.

**Readiness:** M3 is not ready for acceptance and M4 is not authorized.

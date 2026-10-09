# V2 persistence contract — M3 foundation and later logical model

PostgreSQL is durable truth. The table below includes later logical entities; `database/migrations/001_m3_foundation.sql` implements the M3 subset in a private `r2pl_v2` schema. The V1 SQL under `land-rush-prototype/supabase/migrations/` is reference only. The M3 migration is for a disposable V2 database/branch and seeds no production school mapping.

| Entity | Key and required fields | Invariant / transaction use |
|---|---|---|
| `campaigns` | campaign UUID, code, world format, physical write strategy; later rule version/status | One active configuration version per campaign; no silent format change |
| `campaign_schools` | campaign UUID + school ID text, slot 0..15; later status/HQ placement | Unique slot and school per campaign; slots cannot be reassigned |
| `game_users` | campaign UUID + trusted external portal ID → game user UUID, school UUID, status | Email and student ID are metadata, not identity keys; authenticated membership controls all actions |
| `world_chunks` | campaign + chunk ID, revision, 8192-byte mask payload, CRC32 checksum | Materialized snapshot/checkpoint; may lag committed mutations only with replayable durable records |
| `world_mutations` (candidate) | campaign + sector/chunk + revision + compact change + command ID | Required if ADR-011 chooses log/hybrid; append in the same transaction as economy and idempotency, replay after checkpoint |
| `school_fog_chunks` | campaign + school slot + chunk ID, revision, 512-byte payload, CRC32 checksum | Only server-readable; exact school isolation and valid edge padding |
| `tile_knowledge` | campaign + tile index + school, strength, studied timestamp, rule version, expiry if approved | Sparse truth behind mask; same transaction as mask revision |
| `dynamic_objects` | campaign + object ID, type, footprint, config version, published layout version | Layout changes validated and published atomically; no silent overlap/data erasure |
| `landmark_state` / `station_state` / `chest_state` | campaign + object ID, version, approved state fields | Locked with resource and claim transactions |
| `wallet_accounts` and `ledger_entries` | campaign + actor + resource; signed ledger entries, command key | Unique command/resource debit; balance cannot go negative; opening balance plus ledger reconciles |
| `inventory_entries` and `cooldowns` | campaign + user + item/object/action, count/until | Inventory consumption and cooldown update in same action transaction |
| `reward_claims` and `gift_inventory` | unique win/claim ID, product, reservation state, stock | Unique reservation; no oversell; auditable transitions |
| `running_imports` | provider event/version, user, distance, conversion version, correction reference | Deduplicate source updates; separate km, earned Points and spendable balance |
| `command_results` | campaign + actor + idempotency key, canonical payload hash, status, result, committed revision | Unique key; same request replays result, changed request conflicts |
| `outbox_events` | stable bigint event ID, command scope, type/version, payload, delivery lease | Written with business transaction; consumers deduplicate event ID |
| `rule_versions` / `map_versions` | campaign + version, immutable approved content/hash, effective time, approver | Actions record exact active version; admin publishing audited |

## Transaction boundaries

`EXPLORE_TILE` locks/serializes the target sector or chunk, checks school knowledge and balance under the same PostgreSQL transaction, writes a wallet debit, **a durable authoritative world mutation and revision** (either updated chunk row or compact mutation record), knowledge/fog changes required by the approved rule, command result and outbox event, then commits. Snapshot materialization may happen later only if replay from the committed revision is guaranteed. Conflicting concurrent actions either serialize or one retries from current state. No success ack precedes commit. An idempotency record includes actor and canonical payload hash; the same key cannot be reused for a different action. ADR-011 defers the exact write/materialization strategy to M3 benchmarks.

Chest and UniStop reward outcomes, keys, cooldowns, physical gift reservations and claim status follow equivalent atomic boundaries. Random outcomes are generated server-side with a secure generator and persisted before ack. If a transaction retries, it reuses the stored outcome rather than drawing again. Running imports record external source identifiers and corrections separately from game awards. An outbox relay can deliver repeatedly; handlers are idempotent.

## Recovery and migration

At startup, validate registry slots, chunk lengths/endianness, checksums, revisions, sparse-mask agreement and object layout. Recover the latest committed revision from checkpoint plus durable mutations if that design wins; do not serve a stale materialization as authority. A failed validation stops authority rather than repairing silently. Snapshot/checkpoint and mutation/outbox retention policies are defined with measured write rates in M3. Migrations are forward-only, versioned, reviewed and tested on a disposable database; no production data migration is part of M0. Do not import V1 wallet or transient reward state without a separate audited migration decision.

## Implemented M3 subset

The private schema contains `campaigns`, immutable `campaign_schools`, `wallet_accounts`, `ledger_entries`, `command_results`, `world_chunk_heads`, `world_chunks`, `school_fog_chunks`, `world_mutations`, `outbox_events` and `schema_migrations`. No `anon` or `authenticated` grant is made; row-level security is enabled with no public policy. Existing V1 `public` tables are untouched. An explicit `fixture-credit` opening balance is only test data; no Point/Crystal conversion or approved gameplay cost exists here.

`M3TestMutationService` uses one checked-out PostgreSQL client and one transaction for a fixture command. It inserts the `(campaign, actor, 16-byte key)` idempotency claim; an existing key must have the same SHA-256 canonical payload hash and returns the stored result. The current transaction locks a chunk head before reading its world state and debits the wallet with an atomic nonnegative-balance update. It writes exactly one ledger debit, a world revision/effect, final command result and outbox event, then commits. A precommit failure rolls back all of them; an exception or disconnect after commit can be retried from another process and returns the same result. No M2 production opcode is enabled by this service.

Both ADR-011 candidates share the same logical transaction. `full_chunk` rewrites the 8192-byte mask and 512-byte school fog checkpoint in the transaction. `mutation_log` writes a compact revisioned mutation; the materialized chunk and fog can lag, while reads replay every committed mutation after the checkpoint and fail on a revision gap. `materializeChunk` locks the head, verifies checkpoint CRC32 values, replays and checks the sequence, then advances mask/fog checkpoints and checksums in one transaction. The log is retained so a checkpoint can be audited or rebuilt. A chunk-head row still serializes each chunk; the log candidate is expected to reduce bytes written, not eliminate hotspot row contention. The physical choice remains ADR-011 until PostgreSQL results are available.

The outbox row commits with the world and wallet. `OutboxRelay.claim` uses `FOR UPDATE SKIP LOCKED`, a finite lease and a per-claim token; a worker publishes using the stable outbox ID, then marks delivery only while holding its token. A stale worker cannot release or mark a newer claim. A crash after publication but before marking allows repeat delivery, so consumers must deduplicate by ID. There is no external publisher in M3.

M3 test results and write-amplification/lock measurements are reported in `M3_REPORT.md` when a disposable PostgreSQL instance is available. The migration runner requires `R2PL_TEST_DATABASE_URL`, applies the private schema under a transaction and advisory lock, and verifies a SHA-256 migration checksum on repeat runs. It does not auto-run against any V1/production database.

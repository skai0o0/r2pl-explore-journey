# V2 persistence contract — M3 foundation and later logical model

PostgreSQL is durable truth. The table below includes later logical entities; `database/migrations/001_m3_foundation.sql` implements the M3 subset in a private `r2pl_v2` schema. The V1 SQL under `land-rush-prototype/supabase/migrations/` is reference only. The M3 migration is for a disposable V2 database/branch and seeds no production school mapping.

| Entity | Key and required fields | Invariant / transaction use |
|---|---|---|
| `campaigns` | campaign UUID, code, world format, physical write strategy; later rule version/status | One active configuration version per campaign; no silent format change |
| `campaign_schools` | campaign UUID + school ID text, slot 0..15; later status/HQ placement | Unique slot and school per campaign; slots cannot be reassigned |
| `game_users` | campaign UUID + trusted external portal ID → game user UUID, school UUID, status | Email and student ID are metadata, not identity keys; authenticated membership controls all actions |
| `world_chunks` | campaign + chunk ID, revision, 8192-byte mask payload, CRC32 checksum | Materialized snapshot/checkpoint; may lag committed mutations only with replayable durable records |
| `world_mutations` (experimental candidate) | campaign + sector/chunk + revision + compact change + command ID | Retained for benchmark/recovery tests; full-chunk writes are the selected M3 baseline |
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

An eventual approved `EXPLORE_TILE` command must lock/serialize the target sector or chunk, check school knowledge and balance under the same PostgreSQL transaction, write a wallet debit, **a durable authoritative full-chunk mask/fog update and revision**, approved knowledge changes, command result and outbox event, then commit. Conflicting concurrent actions either serialize or one retries from current state. No success ACK precedes commit. An idempotency record includes actor and canonical payload hash; the same key cannot be reused for a different action. M3 validates this transaction shape with an explicit fixture command; it does not approve `EXPLORE_TILE` gameplay or connect the production opcode.

Chest and UniStop reward outcomes, keys, cooldowns, physical gift reservations and claim status follow equivalent atomic boundaries. Random outcomes are generated server-side with a secure generator and persisted before ack. If a transaction retries, it reuses the stored outcome rather than drawing again. Running imports record external source identifiers and corrections separately from game awards. An outbox relay can deliver repeatedly; handlers are idempotent.

## Recovery and migration

At startup, validate registry slots, chunk lengths/endianness, checksums, revisions, sparse-mask agreement and object layout. Recover the latest committed revision from checkpoint plus durable mutations if that design wins; do not serve a stale materialization as authority. A failed validation stops authority rather than repairing silently. Snapshot/checkpoint and mutation/outbox retention policies are defined with measured write rates in M3. Migrations are forward-only, versioned, reviewed and tested on a disposable database; no production data migration is part of M0. Do not import V1 wallet or transient reward state without a separate audited migration decision.

## Implemented M3 subset

The private schema contains `campaigns`, immutable `campaign_schools`, `wallet_accounts`, `ledger_entries`, `command_results`, `world_chunk_heads`, `world_chunks`, `school_fog_chunks`, `world_mutations`, `outbox_events` and `schema_migrations`. No `anon` or `authenticated` grant is made; row-level security is enabled with no public policy. Existing V1 `public` tables are untouched. An explicit `fixture-credit` opening balance is only test data; no Point/Crystal conversion or approved gameplay cost exists here.

`M3TestMutationService` uses one checked-out PostgreSQL client and one transaction for a fixture command. It inserts the `(campaign, actor, 16-byte key)` idempotency claim; an existing key must have the same SHA-256 canonical payload hash and returns the stored result. The current transaction locks a chunk head before reading its world state and debits the wallet with an atomic nonnegative-balance update. It writes exactly one ledger debit, a world revision/effect, final command result and outbox event, then commits. A precommit failure rolls back all of them; an exception or disconnect after commit can be retried from another process and returns the same result. No M2 production opcode is enabled by this service.

## M3.5 synthetic network extension

Migration `002_m35_view_revisions.sql` adds `school_chunk_views(campaign_id,chunk_id,school_slot,view_revision)` and `outbox_dead_letters`. It also prevents a campaign from switching physical write strategy after creation. The M3.5 adapter requires the approved `full_chunk` strategy and an exact match with the in-memory synthetic school registry. Migration 2 is checksum-checked and repeatable. These private tables grant no public access and contain no official school roster.

For a changed fixture tile, the **same transaction** advances the global chunk revision and the affected school's chunk view revision, writes the full mask and school fog, debits the explicit `fixture-credit` wallet, adds a ledger entry, stores the idempotent result, and inserts a version-2 school-projected outbox event. An unchanged or insufficient-credit result commits an idempotent result without incrementing view revision or emitting a world delta. A duplicate key with the same canonical payload returns the stored result; a changed payload conflicts. The wire ACK is enqueued only after commit. If the connection fails after commit, retrying that key returns the stored ACK result.

The outbox payload contains only the affected school's bit and discovery flag. The M3.5 reader checks snapshot CRC and world/chunk revision agreement, then filters the mask to the authenticated synthetic school. Each school/chunk view revision advances only for that school's changed projection, so v1 clients can apply contiguous deltas while other schools receive no hidden event. A malformed outbox projection triggers fresh snapshots for subscribers and then an auditable quarantine row; the authoritative database remains unchanged. Delivery is at least once, and an extra snapshot may replace an already queued delta. Current network authority is **one process**; multiple processes would need a durable ownership/fencing design and cross-process publication before use.

Both ADR-011 candidates share the same logical transaction in the M3 test adapter. `full_chunk` rewrites the 8192-byte mask and 512-byte school fog checkpoint in the transaction and is the **selected M3 baseline**. `mutation_log` writes a compact revisioned mutation; the materialized chunk and fog can lag, while reads replay every committed mutation after the checkpoint and fail on a revision gap. `materializeChunk` locks the head, verifies CRC32 values and edge padding, replays the exact sequence, then advances mask/fog checkpoints in one transaction. The log remains a tested candidate. A chunk-head row serializes each chunk in either strategy. See `M3_REPORT.md` for WAL, contention, checkpoint and recovery measurements.

The outbox row commits with the world and wallet. `OutboxRelay.claim` uses `FOR UPDATE SKIP LOCKED`, a finite lease and a per-claim token; a worker publishes using the stable outbox ID, then marks delivery only while holding its token. A stale worker cannot release or mark a newer claim. A crash after publication but before marking allows repeat delivery, so consumers must deduplicate by ID. There is no external publisher in M3.

M3 test results and write-amplification/lock measurements are reported in `M3_REPORT.md`. The migration runner requires `R2PL_TEST_DATABASE_URL`, applies the private schema under a transaction and advisory lock, and verifies a SHA-256 migration checksum on repeat runs. It was run only against an isolated disposable PostgreSQL 16 database and does not auto-run against any V1/production database.

## Synthetic reward preparation — 2026-10-13

The separate preparation SQL 002 depends on preparation 001 and creates r2pl_prep.reward_targets/discoveries/accounts/receipts/cooldowns/chest_claims/ledger/outbox. Catalog rows are immutable; actor identity uses provisioned preparation bindings; one claim per campaign/Chest and one receipt per campaign/actor/key. Inventory ledger uses separate spend/grant legs, including zero-net Key replacement. All resources are fixture-prefixed. Applied receipts, inventory, cooldown/claim and outbox share one commit. These tables are not production migrations and the existing world snapshot/economy schema is unchanged. See [reward report](REWARD_PREPARATION_REPORT_2026-10-13.md).

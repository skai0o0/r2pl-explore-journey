# V2 persistence contract — M0 proposal

PostgreSQL is durable truth. This is a logical model, not an applied migration. The V1 SQL under `land-rush-prototype/supabase/migrations/` is reference only.

| Entity | Key and required fields | Invariant / transaction use |
|---|---|---|
| `campaigns` | campaign UUID, code, world/rule format, status | One active configuration version per campaign; no silent format change |
| `campaign_schools` | campaign UUID + school UUID; slot 0..15, school code, status, HQ placement | Unique slot and school per campaign; assignments immutable after world data exists |
| `game_users` | campaign UUID + trusted external portal ID → game user UUID, school UUID, status | Email and student ID are metadata, not identity keys; authenticated membership controls all actions |
| `world_chunks` | campaign + chunkX/Z, format, revision, 8192-byte mask payload, checksum | Materialized snapshot/checkpoint; may lag committed mutations only with replayable durable records |
| `world_mutations` (candidate) | campaign + sector/chunk + revision + compact change + command ID | Required if ADR-011 chooses log/hybrid; append in the same transaction as economy and idempotency, replay after checkpoint |
| `school_fog_chunks` | campaign + school + chunkX/Z, revision, 512-byte payload | Only server-readable; exact school isolation and valid edge padding |
| `tile_knowledge` | campaign + tile index + school, strength, studied timestamp, rule version, expiry if approved | Sparse truth behind mask; same transaction as mask revision |
| `dynamic_objects` | campaign + object ID, type, footprint, config version, published layout version | Layout changes validated and published atomically; no silent overlap/data erasure |
| `landmark_state` / `station_state` / `chest_state` | campaign + object ID, version, approved state fields | Locked with resource and claim transactions |
| `wallet_accounts` and `wallet_entries` | campaign + user + resource; signed ledger entries, source, action ID | Unique source/action; aggregate or locked balance cannot go negative |
| `inventory_entries` and `cooldowns` | campaign + user + item/object/action, count/until | Inventory consumption and cooldown update in same action transaction |
| `reward_claims` and `gift_inventory` | unique win/claim ID, product, reservation state, stock | Unique reservation; no oversell; auditable transitions |
| `running_imports` | provider event/version, user, distance, conversion version, correction reference | Deduplicate source updates; separate km, earned Points and spendable balance |
| `command_results` | campaign + actor + idempotency key, canonical payload hash, status, result, committed revision | Unique key; same request replays result, changed request conflicts |
| `outbox_events` | event UUID, aggregate, revision, type/version, payload, delivery state | Written with business transaction; consumers deduplicate event UUID |
| `rule_versions` / `map_versions` | campaign + version, immutable approved content/hash, effective time, approver | Actions record exact active version; admin publishing audited |

## Transaction boundaries

`EXPLORE_TILE` locks/serializes the target sector or chunk, checks school knowledge and balance under the same PostgreSQL transaction, writes a wallet debit, **a durable authoritative world mutation and revision** (either updated chunk row or compact mutation record), knowledge/fog changes required by the approved rule, command result and outbox event, then commits. Snapshot materialization may happen later only if replay from the committed revision is guaranteed. Conflicting concurrent actions either serialize or one retries from current state. No success ack precedes commit. An idempotency record includes actor and canonical payload hash; the same key cannot be reused for a different action. ADR-011 defers the exact write/materialization strategy to M3 benchmarks.

Chest and UniStop reward outcomes, keys, cooldowns, physical gift reservations and claim status follow equivalent atomic boundaries. Random outcomes are generated server-side with a secure generator and persisted before ack. If a transaction retries, it reuses the stored outcome rather than drawing again. Running imports record external source identifiers and corrections separately from game awards. An outbox relay can deliver repeatedly; handlers are idempotent.

## Recovery and migration

At startup, validate registry slots, chunk lengths/endianness, checksums, revisions, sparse-mask agreement and object layout. Recover the latest committed revision from checkpoint plus durable mutations if that design wins; do not serve a stale materialization as authority. A failed validation stops authority rather than repairing silently. Snapshot/checkpoint and mutation/outbox retention policies are defined with measured write rates in M3. Migrations are forward-only, versioned, reviewed and tested on a disposable database; no production data migration is part of M0. Do not import V1 wallet or transient reward state without a separate audited migration decision.

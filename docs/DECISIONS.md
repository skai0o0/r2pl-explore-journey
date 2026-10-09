# Decisions and approval ledger

Status on 2026-10-09: **M0 architecture baseline accepted and M1 authorized, with a generic registry condition**. A `proposed` gameplay decision is not a production rule. Master Plan v1.0 fixes the technology and consistency constraints. `OWNER_REQUIREMENTS.md` remains the latest documented gameplay proposal; gameplay parameters stay pending where noted in `SPEC_CONFLICTS.md`.

| ID | Status | Decision and reason | Revisit trigger |
|---|---|---|---|
| ADR-001 | Plan-mandated; M1 package pin verified | Strict TypeScript; Colyseus, Three.js, PostgreSQL, Vite; Redis only when distributed deployment is justified. Use a modular monolith. M1 pins `@colyseus/core` 0.18.18, `@colyseus/ws-transport` 0.18.4, `@colyseus/sdk` 0.18.5, `@colyseus/schema` 5.0.36, Three.js 0.186.1, Vite 8.3.4 and TypeScript 5.9.3. No V1 lockfile migrates. Loopback request and binary transport smoke passes. | 0.18 compatibility or maintenance changes |
| ADR-002 | Plan-mandated | Server owns all shared state, identity, resources, reward outcomes and permissions. Client prediction is visual only. | Never silently weaken |
| ADR-003 | **Approved for M1** | 1000×1000 row-major tiles; `tileIndex=z*1000+x`; uint16 school-presence mask; 64×64 padded little-endian binary chunks; sparse per-school knowledge metadata and separate one-bit per-school fog. See `PROTOCOL.md`. | Format capacity or map geometry changes |
| ADR-004 | **Approved for M1** | 16×16 chunks, 4×4 logical sectors of 4×4 chunks. Replaceable in-process `SectorAuthority`. Future distributed writers require a durable lease/fencing token checked at commit. | Measured single-process bottleneck |
| ADR-005 | Proposed details | One authenticated Colyseus connection per player in normal operation; viewport subscriptions, revisioned snapshots/deltas, bounded frames, resync, action-specific acknowledgements. No tile Schema objects. | Transport benchmark or security review |
| ADR-006 | Plan-mandated; milestone gate clarified | PostgreSQL commit and idempotency outcome precede a committed-success acknowledgement. M2 uses a clearly marked ephemeral test adapter; production mutating commands fail closed until M3 supplies the durable transaction path. A queued/received response is never called success. | M3 transactional design review |
| ADR-007 | Proposed details | Three.js local instancing/batched buffers, with separate overview strategy and viewport budget. Evaluate V1 50×50 render chunks independently of 64×64 logical data chunks. | Browser GPU measurements |
| ADR-008 | Proposed | Use explicit SQL migrations and a narrow repository interface; no ORM initially. This keeps transaction and locking behavior visible. | A demonstrated need for an ORM plus ADR |
| ADR-009 | **Generic 16-slot registry approved for M1; production roster proposed** | Saved assignments cannot change; additional unused slots may be onboarded. V1 names/bit mapping 0–7 below remain proposed, with 8–15 reserved for production. M1 code contains no production roster. School IDs are never derived from array order or email domains. | Owner registry decision before production campaign data |
| ADR-010 | Proposed | Gameplay rules are versioned configuration records. Unapproved costs, decay, landmark thresholds, and probabilities block affected gameplay commands. No runtime default may quietly become a campaign rule. | Owner approves a rule version |
| ADR-011 | **Candidate; final choice deferred to M3** | Durable world mutation records, economy entries, idempotency outcomes and outbox events must become committed together. Compare full-chunk rewrite, append-only mutation log with materialized snapshots, and a measured hybrid. Benchmark write amplification, chunk-row contention, WAL volume, snapshot lag and recovery time before choosing. See below. | M3 PostgreSQL benchmarks and crash/recovery tests |

## M1 approval record and remaining roster decision

The owner approved ADR-003 and the M1 part of ADR-004, authorized M1 using a generic immutable 16-slot registry, and explicitly deferred confirmation of the V1 school names/bit mapping. ADR-011 remains open until M3 measurements. The table below is a **proposal only** and is absent from executable V2 source and M1 snapshots. Its confirmation is a later production campaign data gate, not an M1 engine gate.

| Proposed slot | Code | School from V1 SQL seed | Status |
|---:|---|---|---|
| 0 | HCMUT | Trường Đại học Bách khoa – ĐHQG TP.HCM | Pending owner confirmation |
| 1 | HCMCOU | Trường Đại học Mở TP.HCM | Pending owner confirmation |
| 2 | DTU | Đại học Duy Tân | Pending owner confirmation |
| 3 | DHHP | Trường Đại học Hải Phòng | Pending owner confirmation |
| 4 | HSU | Trường Đại học Hoa Sen | Pending owner confirmation |
| 5 | HUCE | Đại học Xây dựng Hà Nội | Pending owner confirmation |
| 6 | NTU | Đại học Nha Trang | Pending owner confirmation |
| 7 | HCMIU | Đại học Quốc tế – ĐHQG-HCM | Pending owner confirmation |
| 8–15 | — | Reserved; no school assigned | Reserved |

The owner proposal lists only the first five schools; the Master Plan and V1 SQL seed name eight. Confirming this mapping is required before writing production campaign world data. HQ coordinates and the final eight-school layout remain separate M4 decisions.

## ADR-011 candidate: world durability and materialization

**Problem.** Rewriting an 8192-byte chunk row for each single-tile action amplifies writes and makes a hotspot chunk a row-lock bottleneck. Delaying chunk writes can reduce cost but cannot make a committed gameplay acknowledgement depend on volatile RAM. Snapshot materialization may lag the durable mutation stream; recovery must still reconstruct exact committed revisions before serving clients.

**Alternatives to benchmark in M3:** (A) update the chunk row in every action transaction; (B) append a compact immutable world mutation record in the action transaction and materialize chunk snapshots asynchronously; (C) a hybrid with bounded compaction or periodic checkpoints. Do not select among them now. Measure WAL/bytes per action, database lock wait and abort/retry rates on a single hot chunk versus distributed chunks, action-commit latency, materializer lag, snapshot size/frequency and restart replay time. Include 100–1,000 concurrent-client stages and duplicate/crash cases.

**Non-negotiable consistency:** the wallet debit/credit, authoritative world mutation record or chunk update, chunk revision, command idempotency result and outbox event commit atomically. A materialized snapshot is a derived cache; if it lags, recovery replays committed mutations from its revision. Never acknowledge a successful action based only on a dirty RAM mask or an asynchronously scheduled save. A stale sector writer must fail its database commit after failover.

## Dependency check

V1 pins `colyseus` with `^0.15.16` and uses `colyseus.js` 0.15 in its package files. The [official Colyseus 0.18 migration guide](https://docs.colyseus.io/migrating/0.18) documents 0.18 server and SDK upgrades and the 0.18 Schema 5 requirement. M1 uses exact package pins and tests loopback request/response plus binary messages. Reconnect belongs with the M2 subscription/session path and remains unverified. Optional Colyseus database/admin packages are outside this baseline.

## Decision discipline

Each new ADR records context, options, decision, consequences, owner approval if it changes the Master Plan, and a validation result. Game balance decisions go in `GAME_SPEC.md` and `SPEC_CONFLICTS.md` with rule versions and test cases.

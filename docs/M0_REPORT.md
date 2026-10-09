# M0 review report — 2026-10-09

## Outcome and scope

The M0 architecture audit and proposed operating documents are ready for owner review. The architecture direction was conditionally accepted; **the corrected M0 gate still awaits owner approval, and M1 has not started.** See `M0_REVIEW_ADDENDUM.md` for the correction pass. The V1 clone was inspected read-only at `79e5cfa2a16101fd3872eacb52ef6d2fafcc03d4`, and `git status --short` remained empty after the audit. No V2 application code, database migration, production service or gameplay rule was implemented.

## Findings

1. **Useful V1 engineering:** 2 MB uint16 school mask; little-endian 64×64 chunks and zero edge padding; sparse per-school knowledge; per-school fog; revisioned binary deltas; dirty batching; instanced rendering/culling and local raycast; strong boundary/identity test fixtures. See `V1_REUSE_MATRIX.md` for individual decisions.
2. **Architecture to replace:** `CampusRoom.ts` is 2760 lines and owns transport, identity, gameplay, economy, rewards, editor and synchronization. `main.ts` is 1881 lines, `sceneManager.ts` 1245 and `colyseusClient.ts` 947. Client rendering eagerly creates one million instances despite viewport culling. V1 has parallel owner/knowledge channels and room-wide `world_delta` broadcasts.
3. **Durability gap:** V1 accepts gameplay and sends success before its asynchronous world flush; player wallets/rewards remain in memory. Its PostgreSQL foundation stores chunks/fog/knowledge and uses a single advisory campaign lock, but has no transactional gameplay ledger, outbox, idempotency or distributed fencing. V2 must add those before production committed-success acknowledgements.
4. **Privacy and rules gap:** V1 filters school fog but broadly sends knowledge masks and some shared metadata. The public/school visibility policy is missing. The original Product Owner proposal is now preserved verbatim in `OWNER_REQUIREMENTS.md`. Its displayed reward columns each total 100%, but several values and item labels differ from V1. No table has been normalized or adopted for V2.
5. **Evidence limits:** V1 has 21 test files, including binary/edge/room fixtures and an opt-in PostgreSQL restart script. `world-benchmark.md` reports workstation microbenchmarks only; it does not validate 10k connections, browser GPU load or durable reward consistency. V1 dependencies are not installed in the clone, so no V1 test/build was run during this read-only audit.

## Decisions for review

- Approve or amend ADR-003/004/005/006/008/009/010 in `DECISIONS.md`, especially fixed bit slots, hidden-data filtering and the M2 test-only versus M3 durable gate.
- Confirm the proposed eight school codes/slots in `DECISIONS.md` for M1. HQ coordinates and a signed layout are separate M4 inputs.
- Resolve the genuine gameplay conflicts in `SPEC_CONFLICTS.md` before each affected feature. The original proposal and exact probability columns are now available; external integration and final approved reward/catalog details remain pending.
- Approve the M1 backlog and its acceptance tests in `ROADMAP.md`. This is separate from approving disputed reward mechanics.

## Environment and checks

- Local tools: Node v24.19.0, npm 11.17.0, Git 2.55.0; `agy` 1.3.2 and `mimo` 0.1.15 were detected. Supporting CLIs were not tasked; no permission model or noninteractive mode was assumed.
- Static audit inspected the Master Plan, V1 README/docs, prioritized shared/server/client modules, SQL migrations, tests and benchmark report. A read-only parse summed all six V1 UniStop/Chest loot tables to 1000 each.
- M0 documentation created: `AGENTS.md`, `GAME_SPEC.md`, `ARCHITECTURE.md`, `V1_REUSE_MATRIX.md`, `SPEC_CONFLICTS.md`, `PERFORMANCE_TARGETS.md`, `DECISIONS.md`, `PROTOCOL.md`, `DATA_MODEL.md`, `ROADMAP.md`, `OPERATIONS.md`, this report.
- No TypeScript compilation, test suite, network load or SQL acceptance run was claimed. M0 changed documentation only.

## Recommendation

Review `M0_REVIEW_ADDENDUM.md` and the minimum M1 checklist. Once the owner approves the corrected M0 gate and confirms ADR-003, M1's ADR-004 mapping and ADR-009 slots, M1 can implement the pure world foundation while gameplay/reward conflicts remain visibly blocked. Do not promote the M2 exploration fixture to production until its rule is approved and M3 durability tests pass.

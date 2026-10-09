# R2PL GAME V2 — MASTER IMPLEMENTATION PLAN

**Project:** Road to Predator League 2027 — Hành trình Khám phá  
**Organization:** AMTECH × Acer  
**Document version:** 1.0 — Architecture & Execution Baseline  
**Technical Lead:** Codex  
**Supporting Agents:** Google Antigravity CLI, Xiaomi MiMo Code CLI  
**Reference:** https://github.com/skai0o0/land-rush-prototype

---

## 0. PRIMARY MISSION

Build a production-ready, scalable multiplayer web game for Road to Predator League 2027 (R2PL).

This is a **greenfield V2 implementation**, not an incremental refactor of the V1 application.

The V1 repository must be preserved as a read-only reference for algorithms, data representations, gameplay behavior, benchmarks, assets and test cases.

The V2 architecture must prioritize:

1. **Correctness:** No lost updates, duplicate rewards, double spending or inconsistent shared-world state.
2. **Scalability:** Designed for tens of thousands of registered students, with a performance target of at least 10,000 concurrent connections subject to benchmarking.
3. **Efficiency:** Compact world representation, minimal network traffic, selective synchronization and small client bundles.
4. **Maintainability:** Modular TypeScript architecture that AI coding agents can safely understand, modify and test.
5. **Live Operations:** Continuous event updates, administrative controls, integration with the running campaign and secure reward management.
6. **Preservation:** Reuse proven V1 engineering solutions without inheriting unnecessary complexity.

Do not attempt to recreate V1 feature-for-feature before establishing a reliable V2 foundation.

**The immediate objective is to complete M0 and obtain approval before implementing M1.**

---

## 1. NON-NEGOTIABLE ARCHITECTURE DECISIONS

### ADR-001 — Technology Stack

| Layer | Selected technology |
|---|---|
| Language | TypeScript, strict mode |
| Realtime | Colyseus |
| Colyseus version | Evaluate current 0.18.x; pin a tested compatible release |
| Rendering | Three.js |
| Persistence | PostgreSQL |
| Distributed coordination | Redis, when multi-process scaling is introduced |
| World representation | Uint16Array, binary chunks and sparse metadata |
| Network | WebSocket with binary gameplay protocol |
| Client build | Vite |
| Deployment model | Modular monolith supporting multiple process roles |

Do not introduce a different game engine, ORM, database, framework or message broker without a written Architecture Decision Record (ADR).

Prefer native TypeScript and Node.js capabilities over unnecessary dependencies.

### ADR-002 — Server Authority

All mutations to shared game state must be validated and executed by the server.

The client may render optimistic pending interactions, but must never authoritatively modify:

- Knowledge ownership/membership.
- Player Points, Crystals or inventory.
- Landmark contribution and ownership.
- Chest contents or reward outcomes.
- UniStop cooldowns and reward eligibility.
- Gift redemption status.
- Player identity, school affiliation or privileges.

The server must validate identity, resource availability, gameplay conditions, cooldowns and permissions.

Local-only presentation actions such as camera movement, zoom and UI animations do not require server requests.

### ADR-003 — World Representation

World dimensions: **1000 × 1000 = 1,000,000 tiles.**

Use a 16-bit school knowledge mask:

- 1 bit per school.
- Maximum 16 school slots in format version 1.
- Eight schools currently confirmed.
- Remaining slots reserved for future universities.
- School-to-bit assignments are persistent and must not be silently reassigned.

Core dense representation: `Uint16Array`.

Estimated raw knowledge mask: 2,000,000 bytes.

Use a separate one-bit-per-tile fog representation for each school where appropriate.

Store dynamic states such as challenges, timers, temporary protections and Landmark contributions in sparse structures rather than additional per-tile JavaScript objects.

The school mask represents **which schools hold knowledge**, not a complete description of all gameplay conditions.

Document binary endianness, bounds, schema version and compatibility rules.

### ADR-004 — World Partitioning

Logical chunk size: 64 × 64 tiles.

A 1000 × 1000 map requires 16 × 16 logical chunks, with edge chunks clipped to actual world dimensions.

Design for 4 × 4 sectors, each containing up to 4 × 4 chunks.

Implement the world authority through a replaceable `SectorAuthority` interface.

Start with an in-process implementation that establishes correct behavior.

Move sector authorities to separate processes only after the basic implementation passes correctness and performance tests.

At any moment, a sector must have one authoritative writer.

Distributed ownership requires durable coordination and fencing to prevent stale writers from committing mutations after failover.

Do not confuse the sixteen school bits with the sixteen initial world sectors. They serve unrelated purposes.

### ADR-005 — Networking and Synchronization

Each player should normally maintain one authenticated Colyseus connection.

Implement:

- Compact binary gameplay commands.
- Explicit protocol versions.
- Unique idempotency keys per logical action.
- Chunk subscriptions based on viewport and game rules.
- Initial state snapshots.
- Incremental binary deltas.
- Monotonically increasing chunk revisions.
- Missing-update detection and chunk resynchronization.
- Dedicated acknowledgements for player actions.
- Message size limits, backpressure and rate limiting.

Do not create one Colyseus Schema object per world tile.

Do not broadcast every tile change to all connected students.

Do not send the full map repeatedly.

Use the Colyseus room lifecycle for connection management, but keep business rules outside Room classes.

### ADR-006 — Data Consistency

PostgreSQL is the durable source of truth.

Use database transactions for operations involving multiple related state changes.

Every resource-consuming or reward-producing command must support idempotent retries.

Use reliable event publication with a transactional outbox or an equivalent proven mechanism.

Redis Pub/Sub must not be the only record of a financially or operationally important action.

Do not acknowledge successful gameplay mutations that can still disappear after a server crash.

Distributed message delivery may be at least once; business effects must be idempotent.

### ADR-007 — Rendering

Keep Three.js.

Use batched geometry, GPU-friendly buffers, instancing and viewport-dependent rendering.

Never create one Mesh, DOM element or animation object for each of the one million map cells.

Support map-level overview and detailed local rendering using separate rendering strategies where useful.

Models and textures are excluded from the source code size budget but must have their own runtime memory and download budgets.

---

## 2. GAMEPLAY SCOPE AND SOURCE OF TRUTH

The approved game concept is **Hành trình Khám phá**, replacing the original land-conquest theme.

The game must support:

- Universities and Headquarters.
- Fog of War and Knowledge exploration.
- Shared Knowledge and competitive Knowledge mechanics.
- Vietnamese Scenic Spots and Landmarks.
- Landmark puzzles, illumination and school buffs.
- UniStop Aspire, Nitro and Predator.
- Chests, Keys, Crystals, Points and Gifts.
- External running kilometer integration.
- Player and school leaderboards.
- In-game events, notifications and live campaign operations.
- Administrative map editing and university onboarding.

The game must support eight currently confirmed universities with sixteen slots available in the current world format.

### Specification conflicts

The existing written requirements and V1 implementation contain disagreements, including:

- Point versus Crystal costs for exploration.
- Landmark illumination thresholds.
- Knowledge decay and contest expiration rules.
- University registry and placement.
- Reward configurations.
- Landmark object dimensions.
- Chest and key tier naming.

Some supplied chest probability columns do not total 100% as written.

**Do not silently resolve these differences.**

Do not automatically normalize or modify existing probability tables.

Create a Game Specification containing:

- Approved gameplay rule.
- Current V1 behavior.
- Conflicting requirements.
- Proposed interpretation.
- Approval status.
- Testable acceptance criteria.

Unapproved rules must remain configurable placeholders or explicitly blocked features until a decision is made.

Keep gameplay rules versioned and separate from code implementation.

---

## 3. V1 REFERENCE POLICY

The repository `land-rush-prototype` is a reference, not the architectural foundation of V2.

Read it before implementing equivalent functionality, but never copy an entire module simply because it already exists.

### Prioritized modules for analysis

- `shared/constants/schools.ts`
- `shared/land/`
- `shared/engine/territoryClusterEngine.ts`
- `server/src/world/`
- `server/src/gameplay/`
- `server/src/security/`
- `server/test/`
- `client/src/engine/chunkGridManager.ts`
- `client/src/engine/fogOfWarManager.ts`
- `client/src/engine/sceneManager.ts`
- `client/src/network/colyseusClient.ts`

### Reference-only monoliths

- `server/src/rooms/CampusRoom.ts`
- `client/src/main.ts`

Inspect these files to understand their responsibilities, but do not migrate their monolithic structure.

For every candidate component, choose one of:

- **PORT:** Reuse after extracting and testing an independent algorithm.
- **REDESIGN:** Preserve behavior while replacing the architecture.
- **REBUILD:** Implement anew against V2 contracts.
- **DISCARD:** Legacy behavior no longer required.

Produce a V1-to-V2 migration matrix containing the decision and rationale.

Do not modify, delete, reset or force-push the V1 repository.

---

## 4. TARGET REPOSITORY STRUCTURE

Start with a compact structure:

- `client/` — Rendering, network client, UI, world viewport.
- `server/` — Colyseus rooms, routing, world authority, gameplay services, workers.
- `shared/` — Binary protocol, common types, rules and deterministic utilities.
- `database/` — SQL schema, migrations and seed data.
- `tests/` — Unit, integration, concurrency and performance tests.
- `docs/` — Specifications, ADRs, implementation reports and operations.

Introduce subpackages or further directory nesting only when a real dependency boundary justifies it.

Keep module ownership explicit.

Do not introduce circular dependencies between gameplay, persistence, rendering and transport.

Gameplay calculations should be testable without starting Colyseus, Three.js or PostgreSQL unless those dependencies are intrinsically required.

---

## 5. IMPLEMENTATION MILESTONES

### M0 — Specification Freeze and Architecture Audit

**Goal:** Establish the authoritative design before writing V2 gameplay code.

Tasks:

1. Inspect the V1 repository read-only.
2. Inventory existing features, algorithms, tests and optimizations.
3. Identify technical debt, coupling and obsolete gameplay.
4. Review the 16-bit school mask, world chunking and existing synchronization techniques.
5. Confirm all required V2 gameplay systems.
6. Create a specification conflict register.
7. Establish the initial data model and protocol boundaries.
8. Record ADRs for significant architectural choices.
9. Establish measurable performance and code quality budgets.
10. Create the detailed implementation backlog.

Deliverables:

- `docs/GAME_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/V1_REUSE_MATRIX.md`
- `docs/SPEC_CONFLICTS.md`
- `docs/PERFORMANCE_TARGETS.md`
- `docs/DECISIONS.md`
- `AGENTS.md`
- Initial milestone backlog.

**Acceptance gate:** The owner can review gameplay assumptions, reuse decisions and V2 architecture before implementation starts.

Do not proceed to M1 without approval.

### M1 — Million-Cell World Foundation

**Goal:** Build a deterministic, compact and independently testable world engine.

Implement:

- 1000 × 1000 coordinate system.
- Stable tile identifiers.
- 16-bit school masks.
- Persistent school bit assignments.
- Chunk coordinate/index conversion.
- Fog of War bitsets.
- Chunk serialization/deserialization.
- Sparse dynamic tile metadata.
- Binary format versioning.
- In-memory world repository adapter.
- World bounds validation.
- Basic placeholder world visualization.

Test:

- Correct school bit isolation.
- No integer overflow or bit collision.
- Deterministic serialization.
- Accurate chunk boundaries.
- Edge chunk behavior.
- Map reconstruction after save/load.
- Adding universities without changing existing bit assignments.
- Fog visibility isolation.
- Memory consumption.

**Acceptance gate:** One million cells can be initialized, updated, serialized and restored without creating one million Tile objects.

### M2 — Colyseus Realtime Core

**Goal:** Create an authoritative realtime system with reliable synchronization.

Implement:

- Authentication contract.
- Colyseus Gateway Room.
- Sector Authority interface.
- In-process Sector Router.
- Binary command codec.
- Server-side validation pipeline.
- Command acknowledgements.
- Idempotency-key handling.
- Viewport/chunk subscriptions.
- Snapshot delivery.
- Revisioned delta updates.
- Reconnect and resync.
- Basic metrics and structured logging.

Implement a minimal `EXPLORE_TILE` command for testing.

Test:

- Multiple users viewing the same tile.
- Multiple users attempting the same action.
- Reordered and duplicated command delivery.
- Disconnection during mutation.
- Client reconnect and snapshot recovery.
- Invalid/out-of-bounds commands.
- Unsubscribed viewport filtering.
- Revision gaps and resynchronization.

**Acceptance gate:** Multiple connected clients converge to the same authoritative world state, with no lost updates under tested concurrent scenarios.

Do not implement distributed sector processes yet unless benchmarking demonstrates the need.

### M3 — Durable Persistence and Economy

**Goal:** Make all important changes crash-safe, auditable and transactional.

Implement PostgreSQL-backed:

- Student identity references.
- Student-school membership.
- Running data snapshots.
- Game point ledger.
- Crystal and inventory ledger.
- World snapshots and mutations.
- Idempotency records.
- Knowledge challenge records.
- Reward claim records.
- Transactional event outbox.

Implement atomic operations for:

- Deduct resource and explore.
- Deduct resource and contest Knowledge.
- Add running-derived Points.
- Redeem a Chest Key.
- Grant an in-game reward.
- Reserve a physical Gift.

Important guarantees:

- No negative balances caused by racing requests.
- No duplicate reward for the same request.
- No lost successful mutation following restart.
- No partial resource deduction.
- No duplicate physical gift reservation.
- Deterministic recovery behavior.

**Acceptance gate:** Restart and concurrency tests pass against a real PostgreSQL instance.

### M4 — Playable Gameplay Vertical Slice

**Goal:** Prove the full core game loop using V2 systems.

Implement a playable subset containing:

- Two universities initially.
- Headquarters.
- A small playable region.
- Fog of War.
- Knowledge exploration.
- Shared Knowledge and competition.
- Crystals and Points.
- One Landmark with approved illumination rules.
- Basic player HUD.
- Minimal leaderboard.

Use simple placeholder art.

After the core slice is validated, enable configuration for eight universities and verify capacity for sixteen bit assignments.

Test multiplayer gameplay with real browser clients.

**Acceptance gate:** Multiple students can log in, explore, compete, contribute, disconnect and return without losing legitimate progress.

### M5 — Running Campaign Integration

**Goal:** Connect student identity and running performance to game economy.

The campaign integration backend is operated by a separate team.

Build an API adapter accepting an externally supplied contract.

Do not invent production API endpoints.

Implement:

- Stable external student identifier mapping.
- Verified authentication/session exchange.
- University membership mapping.
- Running kilometer synchronization.
- Kilometer-to-Points conversion service.
- Versioned conversion rules.
- Source update deduplication.
- Data correction/reconciliation.
- Weekly running eligibility calculation.
- Integration failure handling.
- Mock provider for local and automated testing.

Separate:

- Running kilometers.
- Points generated from running.
- Points earned inside the game.
- Spendable balance.
- Crystals and other inventory.
- Physical reward eligibility.

When cumulative running kilometers change, process only the legitimate difference and relevant corrections.

Never grant duplicate Points when an identical API response is received repeatedly.

**Acceptance gate:** The system can synchronize, reconcile and audit student running data without double-crediting.

### M6 — Full Gameplay, Admin and LiveOps

**Goal:** Complete campaign operations around the proven core.

Implement in independently tested batches:

- All approved Landmarks.
- Landmark puzzles and buffs.
- UniStop tiers and cooldowns.
- Chest and Key systems.
- Approved gacha probability tables.
- Gift inventory and eligibility.
- Gift claim/check-in workflow.
- Dynamic university onboarding.
- Map Editor with versioned publishing.
- Scheduled events and milestone triggers.
- In-game notifications.
- Browser push notifications where supported and authorized.
- Leaderboards.
- Operational dashboards.
- Audit logs and administrative permissions.

All randomized rewards must be decided server-side using an appropriate secure random generator.

Test physical Gift inventory as carefully as financial state.

Gift redemption must be auditable and idempotent.

Treat point wagering or similar proposed event mechanics as out of scope until explicitly approved.

**Acceptance gate:** Campaign administrators can operate the game and its approved events without modifying source code for ordinary operations.

### M7 — Scaling, Hardening and Launch Readiness

**Goal:** Verify that V2 is suitable for real campaign traffic.

Implement distributed deployment only where justified:

- Colyseus Redis Presence and Driver.
- Multiple Gateway Rooms/processes.
- Sector routing across processes if necessary.
- Durable command transport.
- Authoritative writer leasing/fencing.
- Recovery after process failure.
- Graceful connection draining.
- Observability and alerting.
- Deployment rollback procedures.

Perform distributed load tests at increasing loads:

- 100 concurrent users.
- 1,000 concurrent users.
- 5,000 concurrent users.
- 10,000 concurrent users.
- Stress tests beyond the planned capacity.

Test both balanced traffic and hotspot scenarios.

Suggested performance goals to evaluate:

- 10,000 concurrent connections.
- Sustained 1,000 gameplay actions per second.
- Short bursts at 3–5 times sustained action load.
- p95 action acknowledgements under 300 ms in the defined test environment.
- p95 visible state convergence under 500 ms in the defined test environment.
- Zero duplicate business effects for identical requests.
- Zero lost acknowledged transactions.

These are acceptance targets to validate, not presumed properties of the proposed architecture.

Collect:

- CPU and RAM per process.
- WebSocket connections and disconnect rates.
- Actions per second.
- Action queue wait time.
- Database transaction latency.
- Redis traffic.
- Outbound bytes per client.
- Hot sector utilization.
- Snapshot and delta sizes.
- End-to-end p50, p95 and p99 latency.
- Reconnect and recovery success.

Load generators must not become the bottleneck. Distribute them when required.

**Acceptance gate:** Publish a benchmark report showing measured capacity, limiting factors, infrastructure configuration and remaining risks.

---

## 6. MULTIPLAYER CONSISTENCY CONTRACT

This section applies to every gameplay feature.

### A. Command Processing

Every mutating command follows:

`Receive → Authenticate → Validate → Route → Execute → Commit → Acknowledge → Publish Delta`

A command must include a protocol version and stable idempotency identity.

Duplicate requests with identical contents return the previously committed result.

Conflicting requests using the same idempotency key must be rejected.

### B. Single Writer

All changes to a particular world tile must be serialized through its current authoritative sector.

For actions involving multiple sectors, implement explicit coordination with deterministic ordering or transaction-based conflict protection.

Do not rely on arrival order across different WebSocket connections as a global ordering guarantee.

### C. Atomic Resource Operations

Resource spending and corresponding world mutations are one logical transaction.

A successful result must not be sent until durability requirements are met.

### D. Revisioned Synchronization

Every world chunk has a monotonic revision.

A client receives snapshots and deltas only for authorized visible/subscribed data.

Subscribe before fetching a snapshot or otherwise handle the synchronization gap explicitly.

If revisions are missing, resynchronize the affected chunk.

Do not leak hidden world information through snapshots, metadata or notification payloads.

### E. Failover Safety

A new authoritative writer cannot become active without invalidating or fencing the previous writer.

Recovered state must account for committed transactions and queued but unresolved commands.

Do not assume Redis Pub/Sub provides durable replay.

---

## 7. PERFORMANCE AND CODE SIZE POLICY

Source size is a design signal, not a correctness metric.

Target a lean implementation, with approximately 1 MB of first-party source code as an initial soft budget, excluding:

- Test suites.
- Documentation.
- 3D models.
- Textures and image assets.
- Generated build artifacts.
- Installed dependencies.
- Lockfiles.

Measure these categories separately.

Use automated reporting of source size, production bundle size, compressed transfer size and runtime memory.

Prefer small, cohesive modules. A file exceeding roughly 400 lines should trigger a responsibility review, not automatic splitting.

Avoid:

- God objects and monolithic Room classes.
- Duplicate gameplay rule implementations.
- Unnecessary dependencies and wrappers.
- Giant serialized world objects.
- A million individual tile entities.
- Full-world broadcasts.
- Unbounded event queues.
- Frequent full-table/database writes.
- Continuous scanning of all tiles for expiration.
- Client-side authoritative calculations.

Introduce a performance optimization only when its correctness is established and its benefit can be measured.

Preserve V1 algorithms that outperform the V2 equivalent when they satisfy current contracts.

---

## 8. AI AGENT ORCHESTRATION

### Codex — Primary Technical Owner

Codex owns:

- Planning.
- Architecture decisions.
- Task decomposition.
- Final code integration.
- Test execution.
- Conflict resolution.
- Documentation updates.
- Progress reporting.

Codex is the only agent authorized to approve integration of changes into the V2 mainline, subject to the human owner's review requirements.

### Google Antigravity — Secondary Technical Reviewer

When installed and available, use Antigravity for independent, bounded work such as:

- Architecture critique.
- V1 algorithm examination.
- Performance investigation.
- Code review.
- Security review.
- Alternative implementation proposals.

Prefer read-only analysis unless a specific implementation task has been assigned.

### Xiaomi MiMo Code — Supporting Implementation and QA

When installed and available, use MiMo for bounded tasks such as:

- Independent algorithm implementation.
- Unit test generation.
- Protocol review.
- Bug reproduction.
- Code simplification proposals.
- Adversarial edge-case testing.

### Coordination Rules

Before invoking an external CLI, inspect its installed version, supported commands and permission model.

Do not assume that a CLI supports a particular noninteractive flag.

If a supporting CLI is unavailable, continue using Codex alone. Do not block M0.

Never allow several agents to modify the same working tree or files concurrently.

Use isolated Git worktrees or branches for parallel implementation.

Supporting agents must receive explicit inputs, scope, deliverables and write permissions.

All contributions require Codex review and automated tests before integration.

Agents must never access production credentials unnecessarily.

Do not expose student information, real Gift claims or API secrets to an auxiliary agent without explicit authorization.

---

## 9. REQUIRED PROJECT OPERATING DOCUMENTS

Create and maintain:

- `AGENTS.md` — Repository-wide coding and agent instructions.
- `docs/GAME_SPEC.md` — Authoritative gameplay specification.
- `docs/ARCHITECTURE.md` — System architecture and boundaries.
- `docs/PROTOCOL.md` — Binary protocol and message schemas.
- `docs/DATA_MODEL.md` — Persistence contracts.
- `docs/DECISIONS.md` — Architecture and gameplay decision records.
- `docs/V1_REUSE_MATRIX.md` — V1 reference and migration decisions.
- `docs/SPEC_CONFLICTS.md` — Unresolved product requirements.
- `docs/ROADMAP.md` — Milestone execution state.
- `docs/PERFORMANCE_TARGETS.md` — Budgets and measured benchmarks.
- `docs/OPERATIONS.md` — Deployment, monitoring and recovery procedures.

Documentation must reflect implemented behavior, not speculative functionality.

---

## 10. DEFINITION OF DONE

Every implementation task must meet all applicable conditions:

- TypeScript compiles cleanly in strict mode.
- Lint and formatting checks pass.
- New behavior has relevant automated tests.
- Existing regression tests continue to pass.
- No unauthorized gameplay rule changes.
- No unjustified dependencies.
- No new client-authoritative mutations.
- No undocumented database schema changes.
- No hidden breaking changes to binary protocol.
- No accidental logging of credentials or personal student data.
- Documentation is updated where relevant.
- Performance regression is investigated when measured.
- Changes are committed in reviewable units.

Each milestone must produce a short completion report:

1. Implemented functionality.
2. Modified modules.
3. Tests executed and results.
4. Measurements collected.
5. Known limitations.
6. Architectural decisions made.
7. Remaining risks.
8. Recommendation for the next milestone.

Do not report a milestone as completed if its acceptance criteria were not tested.

---

## 11. STOP CONDITIONS

Stop implementation and report to the owner when:

- A gameplay requirement is contradictory and affects player rewards or competition fairness.
- A proposed change breaks the 16-bit world format or school identity mapping.
- A distributed synchronization issue risks lost updates.
- An economy transaction could double-credit or double-spend.
- Real Gift probability or eligibility rules need modification.
- An external API contract is missing.
- The architecture is becoming significantly more complex than the approved design.
- A performance target fails and requires an architectural change.
- A production data migration or destructive operation would be required.

Do not resolve these issues by quietly inventing alternative game mechanics.

---

## 12. IMMEDIATE EXECUTION INSTRUCTION

**Start with M0 only.**

First, inspect the available V1 reference repository and the V2 workspace.

If V1 is not present locally, use the supplied GitHub repository as a read-only reference.

Verify the environment and available CLI tools.

Create the M0 documentation and perform the architecture/codebase audit.

Explicitly identify unresolved gameplay rules and architectural risks.

Present an M0 completion report and a proposed M1 implementation backlog.

**Do not start implementing the million-cell engine, rewrite gameplay, configure production services or migrate code into V2 before M0 is approved.**

The primary success condition for M0 is that the human owner can clearly understand and approve what will be built, which legacy elements will be reused, and how subsequent milestones will be validated.

---

**End of Master Implementation Plan v1.0**
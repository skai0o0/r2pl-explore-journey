# R2PL Game V2 agent instructions

## Scope and authority

- This directory is the greenfield V2 workspace. `land-rush-prototype/` is a read-only V1 reference. Never edit, reset, clean, or commit inside it.
- The owner-provided `writing-block.md` is the Master Implementation Plan v1.0. `docs/OWNER_REQUIREMENTS.md` preserves the original Product Owner gameplay concept as a proposal, not approved production rules. For V2, approved decisions in `docs/DECISIONS.md` and approved rules in `docs/GAME_SPEC.md` govern implementation. Record discrepancies in `docs/SPEC_CONFLICTS.md`; do not infer approval from the owner proposal, V1 code or tests.
- M0/M1 were accepted. M2 Realtime Core was conditionally accepted; M2.5 and M2.6 were accepted for their measured scope; M3's synthetic durability foundation and ADR-011 full-chunk baseline were technically accepted on 2026-10-10. M3.5 correctness was accepted and M3.6 reviewed. The owner authorized **M4-A, a development-only playable vertical slice**; stop after M4-A for owner feedback. Hotspot performance remains a production launch blocker, not a blocker for the local prototype. Do not start M5, create unapproved gameplay rules, or migrate V1 code.
- M1/M2/M3 use a generic immutable 16-slot school registry and synthetic fixtures. The proposed V1 0–7 mapping remains pending owner confirmation and must not be persisted as production data. Keep original and revised probability tables traceable without normalization.
- Keep the first V2 source layout compact: `client/`, `server/`, `shared/`, `database/`, `tests/`, `docs/`. Add nesting only for a real boundary.

## Coding contract for later milestones

- TypeScript strict mode; explicit types at package boundaries. Pure deterministic world and rule functions in `shared/`; no imports from Colyseus, Three.js, PostgreSQL, or browser globals there.
- `server/` alone authenticates users and commits gameplay mutations. Room classes handle transport and lifecycle, while services handle rules. `client/` is presentation and may display pending actions only.
- PostgreSQL is durable truth. Treat resource spending and its world effect as one transaction. Store an idempotency record keyed by campaign, actor, and command key; reject reuse with different payload. Publish committed events through an outbox. Never acknowledge a successful durable action before commit.
- One writer per sector. Keep the in-process `SectorAuthority` replaceable. Do not add Redis coordination or multi-process authorities until benchmarks justify it and fencing is implemented.
- Version binary formats and rules. Validate all untrusted input, array lengths, bounds, school slots, revisions, and visibility before use. Do not leak hidden map data in snapshots, events, logs, or errors.
- Prefer small modules and standard APIs. Review files over roughly 400 lines for mixed responsibilities; size alone is not a reason to split.
- Add focused tests for invariants, concurrency, crash recovery, and binary compatibility. Report measurements with environment and workload. Do not describe V1 microbenchmarks as V2 capacity.
- No new engine, ORM, database, framework, or broker without an ADR and owner review. No real student data or production credentials in fixtures or auxiliary tools.

## Definition of done

Strict compilation, lint/format, relevant tests, documented schema/protocol/rule changes, no unauthorized gameplay change, measured performance where applicable, and a reviewable milestone report. Preserve the owner review gate after M4-A.

## Multi-Agent Review policy — active for M3.5

- Codex owns architecture, edits, tests, measurements and final integration decisions. Supporting CLIs receive bounded, independent **read-only review** requests and must not modify files, run migrations or access production services.
- Request Antigravity review of ADR-011, transactional world ownership and realtime fanout; request Xiaomi MiMo review of concurrency, retry/recovery and versioned delta edge cases. Do not let reviews make uncontrolled parallel changes to shared files.
- Record each request, CLI availability/authentication result, substantive findings, Codex disposition and any unreviewed scope in `docs/AGENT_REVIEWS.md`. An unavailable or unauthenticated CLI is reported as such, never counted as a successful review.

# R2PL Game V2 agent instructions

## Scope and authority

- This directory is the greenfield V2 workspace. `land-rush-prototype/` is a read-only V1 reference. Never edit, reset, clean, or commit inside it.
- The owner-provided `writing-block.md` is the Master Implementation Plan v1.0. `docs/OWNER_REQUIREMENTS.md` preserves the original Product Owner gameplay concept as a proposal, not approved production rules. For V2, approved decisions in `docs/DECISIONS.md` and approved rules in `docs/GAME_SPEC.md` govern implementation. Record discrepancies in `docs/SPEC_CONFLICTS.md`; do not infer approval from the owner proposal, V1 code or tests.
- M0/M1 were accepted. M2 Realtime Core was conditionally accepted; M2.5 and M2.6 were accepted for their measured scope; M3's synthetic durability foundation and ADR-011 full-chunk baseline were technically accepted on 2026-10-10. M3.5 correctness was accepted and M3.6 reviewed. M4-A is the accepted playable baseline. The owner authorized a parallel development iteration with Antigravity on frontend, MiMo on pure gameplay rules, and Codex on authoritative integration. Stop for owner review after the improved playable build. Hotspot performance remains a production launch blocker, not a development blocker. Do not start M5, enable unapproved production rules, or migrate V1 code.
- M1/M2/M3 use a generic immutable 16-slot school registry and synthetic fixtures. The proposed V1 0–7 mapping remains pending owner confirmation and must not be persisted as production data. Keep original and revised probability tables traceable without normalization.
- Owner direction 2026-10-13 authorizes feasible development and blocked-integration infrastructure preparation, with the Gamenote V2 file as the latest product idea reference where historical proposals conflict. This authorization does not enable production mutations or supply a real campaign API / signed production ruleVersion. See `docs/INTEGRATION_PREPARATION_REPORT_2026-10-13.md` for the bounded increment and remaining gates.
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

## Multi-agent implementation policy — active for the next gameplay iteration

- Codex owns architecture, minimal shared contracts, Colyseus/PostgreSQL integration, review, merges and final tests. Antigravity owns client presentation in its isolated worktree; MiMo owns pure gameplay rules and tests in its isolated worktree. Each agent may edit and commit only its assigned files. No agent may edit V1, production data, credentials, the integration branch, or another agent's worktree.
- Both external agents use the exact owner-requested models and high effort. They may read the listed V2 architecture, specification and assigned source files; do not pass credentials, production data or V1 source. Keep code changes bounded, synthetic development rules explicit, and protocol v1 unchanged. Codex reviews every agent diff before integration.
- Report actual model, worktree branch, commit, tests and contribution. If a CLI cannot implement, report the blocker rather than substituting a different model.

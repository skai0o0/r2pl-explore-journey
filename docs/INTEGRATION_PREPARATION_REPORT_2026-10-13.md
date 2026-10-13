# Integration preparation increment — 2026-10-13

Status: reviewed development/preparation increment; production integration and full M4 acceptance remain gated.
Git base: b3fdc7b42a98b0db809b6b7231335e2b71c77fcb, branch codex/m4a-playable.

## Owner direction and scope

The owner authorized completing feasible work and preparing infrastructure for blocked features, and named R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt as the latest product idea source. That latest direction supersedes historical docs-only restrictions for THIS increment. It does not sign prices, reward eligibility, Knowledge lifecycle or a production ruleVersion.

For conflicting product proposals, use Gamenote direction for preparation: separate Points/Crystals, exact reward probabilities, UniStop 12h/24h/24h with no accumulated turns, non-running players may receive ingame resources while physical Gift eligibility is separate. Earlier Round-4 restriction of all UniStop access is not silently selected. Other conflicting footprint/Landmark/Knowledge proposals remain explicit and require a consistent implementation spec; no previously inactive candidate was activated.

## Implemented

| Boundary | Contribution |
|---|---|
| shared/integration/running.ts | Normalized internal snapshot contract, canonical decimal integers, storage bounds, Vietnam Monday week boundary, explicit versioned rational conversion, cumulative rounding and correction plan |
| shared/rewards/catalog.ts | Immutable UniStop and Chest reference tables, exact integer weights out of 1000; no normalization or production catalog/tier mapping |
| shared/rewards/reference.ts | Deterministic reference selection, cooldown boundaries without banked turns, positive current-week running fact; no award or eligibility policy mutation |
| server/integration/CampaignProvider.ts | Provider session/running interfaces and server identity resolver; no invented external endpoint |
| server/integration/CampaignSyncService.ts | Session validation, identity binding, snapshot freshness, membership/session revalidation, safe provider errors |
| server/integration/PgRunningPreparation.ts | Disposable-DB transaction: lock provisioned binding/account, revision receipt, ledger, checkpoint, private outbox; replay/conflict/stale handling |
| server/integration/RewardPreparation.ts | Server crypto.randomInt reference sampler; does not consume Keys, reserve Gifts or grant resources |
| database/preparation/001_running_sync_dev.sql | Separate r2pl_prep schema with fixture-running-points only; outside the normal migration chain |
| scripts/test-postgres.ts | Guarded loopback disposable-database runner, applies both baseline migrations before serial regression |

No new dependency, engine, broker, production SQL migration, protocol opcode or live mutation route was introduced. Existing Colyseus protocol v1 and PRODUCTION_DISABLED guard remain unchanged. Client source was not changed; preparation modules are not imported by the browser or live launcher.

## Correctness behavior

- Same provider revision and same canonical payload returns the committed receipt; changed payload or conversion with that revision is rejected.
- New revisions reconcile floor(totalMeters × numerator / denominator) against the previous attributed total. Fractional residues are not discarded by independently rounding each increment.
- Out-of-order older revisions cannot rewind a checkpoint. A changed conversion requires an explicit rebase instead of hidden credit changes.
- Downward correction may debit the synthetic balance. If funds have been spent and balance would turn negative, persist reconciliation_required, keep balance/checkpoint unchanged and produce a private durable review event. A repeated blocked revision returns the same result; resolution/rebase is deliberately not automatic or a production policy.
- Receipt, nonzero ledger, applied checkpoint/balance and outbox commit atomically. No committed result is returned before COMMIT. If an outbox insert fails, all writes roll back.
- Identity must already be provisioned server-side, mapped to the campaign, provider and school. No email-domain inference, client schoolSlot trust or automatic onboarding from feed fields.
- No inferred Gift fallback, redraw, stock policy or Key/Chest tier alias. The reference tables preserve all Gamenote percentages.

## Verification

Windows, Node v24.19.0, existing bundled PostgreSQL 16 runtime. New isolated cluster initialized in a temporary directory, loopback port 55439, database r2pl_prep_test_current. This is synthetic correctness evidence, not a capacity benchmark.

| Check | Result |
|---|---|
| Strict TypeScript compilation | PASS |
| Biome lint/format | PASS, 71 files |
| Full serial suite against PostgreSQL | 80/80 PASS, 0 skipped, about 8.73s |
| New preparation coverage | 11 contract/reward/provider tests + 6 PostgreSQL subtests (7 reported including parent) |
| 16 duplicate concurrent feeds | One committed credit, 15 replays, one receipt/ledger/outbox |
| Payload conflict, stale revision, corrected km, fractional carry, depleted-wallet correction | PASS |
| Outbox failure rollback and fresh service replay | PASS |
| Existing durable network/crash/retry regression | PASS |
| Client build | PASS; JS 807.27kB, gzip 215.92kB; CSS 12.40kB, gzip 3.58kB |
| Browser smoke | Partial evidence added; see M4C_BROWSER_SMOKE_2026-10-13.md |

The first full suite used a fresh database without migration 002 and failed six M3.5/M3.6 checks. Missing school_chunk_views was the root fixture setup issue. The new guarded runner applies migration 001 AND 002; the final full suite passed. No realtime behavior was changed to mask those failures. Vite's existing >500kB chunk warning remains.

## How to verify

Use an empty disposable PostgreSQL database on loopback named r2pl_prep_test_example. Set R2PL_TEST_DATABASE_URL to that database and run npm run test:postgres. The runner applies both existing baseline migrations and sets the separate preparation-test URL for the new tests.

npm run test:preparation runs only the preparation contract tests plus the optional PostgreSQL test. To include PostgreSQL in that command, explicitly set R2PL_PREPARATION_DATABASE_URL to a loopback r2pl_prep_test_* database. Without it, the PostgreSQL test is SKIPPED, not passed. The new synthetic schema is not applied by play:local or migrate:m3/migrate:m35.

## Remaining integration work

1. External team: actual session verification contract, stable school/student mapping, normalized km units, trusted source revision and correction semantics. Provider/resolver implementations must adapt that real contract.
2. Owner: signed conversion, first-sync/backfill, correction/debt/rebase behavior, freshness and Gift eligibility policy. The test conversion is deliberately synthetic with no default.
3. Integration: reviewed production schema/versioning, authentication, event delivery/lease/replay and actor-private receipts. Preparation outbox is durable but has no live relay or public subscription.
4. Rewards: durable per-actor cooldown reservation, Key/Chest transaction, secure persisted roll, Gift stock and entitlement/check-in workflow. Samplers/cooldown helpers alone do not complete these features.
5. Gameplay: Knowledge, Landmark, full scoring and world design implementation remain separate; legacy candidates stay inactive.
6. Release: M4-C real-device/GPU acceptance and M3.6 hotspot capacity remain open. M5/M6/M7 are not completed by this preparation increment.

## Contributions and review gate

Codex implemented minimal shared contracts/reference configuration, server integration, disposable schema, tests and documentation on codex/m4a-playable. The runtime identifies Codex as GPT-6 based; an exact model ID is not exposed here. No external agent contribution or model execution is claimed. where.exe could not discover agy/antigravity or mimo/mimocode in the current PATH; no replacement model was substituted. No external agent worktree, V1 source, credential or production data was edited.

The increment is ready for owner review. Stop before activating production or beginning another gameplay iteration; the existing playable baseline remains available for local review.

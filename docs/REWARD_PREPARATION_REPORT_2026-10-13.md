# Durable reward preparation increment — 2026-10-13

Status: synthetic transaction infrastructure delivered for owner review. Not production gameplay or M6 completion.
Git base: 2c162a524b4929f7b956d24551993d2a7916bba1, branch codex/m4a-playable.

## Scope and product direction

Owner continued the authorized feasible-development / blocked-integration preparation work. Gamenote V2 remains the latest product idea reference. This increment implements authoritative transaction infrastructure for UniStop and finite Key-protected Chest, keeping real Gifts, identity and campaign configuration gated.

The Gamenote Aspire table is used unchanged because Gift has weight zero. Nitro/Predator UniStops have positive Gift probability and return POLICY_PENDING BEFORE RNG, inventory or cooldown effects. They are not filtered, normalized, rerolled or silently given a fallback. Chests in this increment have explicit fixed nonphysical fixture rewards (a Gamenote-supported idea), not a published Chest tier/gacha mapping. All Chest gacha reference tables still contain Gifts and remain inactive.

## Implemented modules

- shared/rewards/commands.ts: bounded internal command DTO, canonical UUID command key, exact fixture version, rejection/receipt types, fixed nonphysical reward validation. Client-supplied price, schoolSlot, quantity and reward fields are rejected.
- server/integration/PgRewardPreparation.ts: server-bound identity, discovery checks, idempotent persisted result, server RNG, per-actor UniStop cooldown, Key debit, one finite Chest claim, inventory grants, separate spend/grant ledger legs and actor-private outbox in one PostgreSQL transaction.
- database/preparation/002_reward_transactions_dev.sql: isolated r2pl_prep fixture catalog, discovery, inventory, receipts, cooldowns, Chest claims, ledger and outbox. Requires preparation 001; not part of migrate:m3/migrate:m35 or play:local.
- scripts/demo-rewards.ts: guarded, self-cleaning disposable demo using two synthetic explorers. No public API or gameplay room route.
- scripts/reward-recovery-child.ts: explicitly gated test helper that terminates AFTER commit and BEFORE returning a result.
- tests/reward-preparation-contract.test.ts and reward-preparation-postgres.test.ts: adversarial contracts, races, replay, cooldown, visibility, overflow, rollback and process termination.

No client code, production database migration, binary protocol v1, world masks, map layout or existing fixture-credit wallet was changed. New resources are fixture-points, fixture-crystals, fixture-treasure-map and fixture-key in separate preparation accounts. They are not connected to the browser exploration credits or running preparation account.

## Transaction and privacy guarantees

1. Lock provisioned actor binding, check existing command receipt, verify actor discovery, then lock the selected target (Chest exclusive; UniStop shared). Inventory operations occur only on the bound actor's account. Chest target serialization and unique claim constrain one successful open globally.
2. Same campaign/actor/key and identical command returns the committed receipt. A different payload with that key throws RewardPayloadConflict. UUID key case is canonicalized. Retries do not sample again or advance cooldown.
3. Production constructor modes / rule versions are rejected. Default RNG is node:crypto.randomInt(1000). Sample ticket and exact outcome are stored before COMMIT, with money/inventory and the world-object claim. Deterministic RNG/clock injection exists only on this explicitly synthetic adapter for tests.
4. Default time is PostgreSQL clock_timestamp at processing after actor/target locks. The receipt field processedAtMs records this decision time, not a claimed database commit timestamp; cooldown stores it only when the entire transaction commits. Exact cooldown equality is available; late arrival grants one turn, not accumulated missed spins. No client clock is accepted in the command.
5. Missing, hidden, consumed and wrong-kind targets use NOT_AVAILABLE as appropriate, with no reward or rival identity. Discovery is checked per actor before lookup. One student's Chest discovery does not grant visibility to other students at the same school. Personal historical receipt replay is allowed after the command has committed; a future public projection/relay must retain actor authorization.
6. Winning Chest opener spends exactly one fixture Key. Losing race, missing Key and rejected command do not spend it. If a Chest awards a Key, spend and grant are separate ledger entries even when the net change is zero.
7. Receipt, cooldown/claim, inventory, ledger and applied-command outbox commit atomically. No applied receipt is returned before COMMIT. Outbox failure or bigint overflow rolls back every effect. Rejected receipts persist for idempotency but emit no reward event or cooldown.
8. No Gift stock, physical entitlement, weekly eligibility fallback, conditional redraw, school capture rule or Key-tier alias is invented. Server provisioning grants synthetic access for tests; real access/contact/visibility requirements remain pending.

## Verification

Windows; Node v24.19.0; PostgreSQL 16.15 on loopback 127.0.0.1:55439, database r2pl_prep_test_current. Direct service callers are synthetic actors, not browser-load or capacity evidence.

| Check | Result |
|---|---|
| Strict TypeScript | PASS |
| Biome lint/format | PASS, 77 files |
| Full guarded serial PostgreSQL regression | 94/94 PASS, zero skipped, about 9.47 seconds |
| New focused reward checks | 14/14 PASS (2 contract checks + 11 PostgreSQL subtests + parent) |
| 16 same-key spins | One committed reward/RNG call, 15 receipt replays |
| 16 distinct-key spins on one cooldown | One grant, 15 COOLDOWN rejections |
| Exact 12h and missed-cycle behavior | PASS |
| 20 actors opening one Chest | One winner; only winner loses a Key; losers retain inventory |
| One Key / two simultaneous Chest requests | One open; remaining Chest is still available to another valid actor |
| Actor-private discovery / forged membership | PASS |
| Key spend+grant conservation / overflow | PASS |
| Injected outbox insert failure | Entire Chest and UniStop transactions roll back; same keys can then succeed |
| Real child process exits with code 86 after commit | New service returns same persisted reward without reroll or double grant |
| CLI demo | PASS: sampled Crystal x1; replay; cooldown rejection; one Chest winner receives Points x2 and spends one Key; loser retains Key |
| Client build | PASS; JS 807.27kB / gzip 215.92kB, CSS 12.40kB / gzip 3.58kB |

A first test incorrectly compared JSON.stringify ordering of live receipts and PostgreSQL JSONB receipts. PostgreSQL reorders object keys; the invariant now uses deep value equality. No transaction logic was altered to bypass that assertion. Vite's existing >500kB bundle warning remains. No hotspot load, GPU or fresh browser UX measurement was made in this backend increment.

Size review: the adapter is about 302 lines and has one transaction responsibility with two commands. The approximately 513-line PostgreSQL test file is one cohesive invariant fixture with shared setup/cleanup and sequential isolated-actor scenarios; it is retained to avoid duplicating lifecycle helpers. No transport or production business rule was mixed into it.

## Reproduce

Set R2PL_PREPARATION_DATABASE_URL to a disposable loopback database named r2pl_prep_test_example. Run npm run test:rewards for the focused checks. Without that variable, PostgreSQL checks are SKIPPED; the contract checks alone do not verify durability.

For the demo, also set R2PL_REWARD_DEMO=1 and run npm run demo:rewards. The demo applies only preparation schemas, uses crypto RNG for Aspire, seeds explicit fixture Key/Chest inputs, prints synthetic receipts/inventory, and removes ONLY its newly generated campaign rows. Do not expose it as an external endpoint. Output reward varies legitimately with the random draw.

npm run test:preparation now includes running AND reward preparation checks. npm run test:postgres remains the full regression command with both baseline migrations prepared first.

## Remaining gates and contribution

- Real identity/session, school access/contact, world placement and approved resource conversion/inventory catalog must precede a live command adapter.
- Nitro/Predator and Chest gacha await Gift eligibility, stock exhaustion, reservation, entitlement/check-in, and explicit fallback/no-fallback policy. Their exact tables remain traceable.
- Durable outbox delivery/actor-private projections and a reviewed frontend are separate work. The preparation outbox is currently durable storage, not a connected relay.
- Landmark, Knowledge lifecycle, map/editor and complete scoring remain outside this increment. M3.6 hotspot and M4-C device/GPU acceptance remain open.

Codex implemented assigned server integration, minimal shared contracts, disposable schema and integration tests on codex/m4a-playable. Runtime identifies Codex as GPT-6 based; exact model ID is not exposed. Antigravity/MiMo CLIs were not discoverable in current PATH (agy/mimo checks also failed); no model or agent substitution, external worktree edit or frontend contribution is claimed. Existing isolated external worktrees were not modified. V1, production data, credentials and unrelated SKILL.md were untouched.

Stop for owner review of this increment before a further gameplay iteration or production activation.

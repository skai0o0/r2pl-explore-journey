# Completion increment02 — shared dev reward wallet and private API

Date2026-10-14; basefffc972. Status: backend/contract increment delivered; UI presentation remains BLOCKED on assigned frontend tooling. G-V1/G-FULL not achieved. No production rule or permission is activated.

## What changed

PgRewardPreparation now accepts an internal RewardWalletAdapter, keeping its original preparation-wallet behavior as the default. DevRewardWallet routes synthetic Points outcomes to the existing fixture-credit exploration wallet, while Crystals/Treasure Map/Key use separate resources in the same r2pl_v2 wallet/ledger. This mapping is an explicit dev fixture unit alias, not a production conversion policy. Running reconciliation remains in its preparation account until conversion/integration is approved.

The same PostgreSQL transaction reserves the global campaign+actor+command key, decides roll/cooldown/claim, spends Key, grants wallet/inventory, writes reward receipt/detail/net ledger and actor-private outbox, finishes the command and commits before returning. Reward keys and binary exploration keys share the idempotency namespace; collisions with different commands fail without side effects. Replay does not sample again.

A new preparation-only SQL file creates playable_reward_ledger for immutable spend/grant details. v0 ledger stores one net nonzero row per command/resource: Key1 spent and Key1 awarded has no net row, but both legs persist in the detail table. Net ledger modifications occur only within the uncommitted reward transaction; committed history is not rewritten. FK/check constraints, global receipt and detailed liabilities remain auditable. No production migration or new dependency.

SchoolPlayServer provisions explicit synthetic bindings, starter Key1, zero resource accounts and own-school starter discoveries; fixed Chest Points2 and exact Aspire table can be tested. These are development access grants, not production map/visibility rules. Immutable target conflicts are checked on restart. Existing exploration balances and inventory are not refilled/reset.

## HTTP and frontend contract

- GET /api/fixture/me includes validated inventory and conservation across4 resources.
- GET /api/fixture/rewards returns own discovered catalog, cooldown/claimed/pending states.
- POST /api/fixture/rewards accepts only key/kind/targetId/ruleVersion, <=4096-byte JSON, synthetic bearer auth, same-origin check and per-actor rate limit. Reuse with changed payload returns409.
- GET /api/fixture/rewards/events?after=... is a durable actor-private paginated stream, max50 events, canonical bounded cursor. It is pull delivery, not a new WebSocket opcode or a delivered_at relay. Event IDs are stable; consumer dedup/cursor is per actor.
- client/src/rewardClient.ts supplies transport only; shared/rewards/playable.ts validates receipts, inventory, catalog and events and rejects injected fields/inconsistent states. Existing main.ts does not mount a reward panel yet.

Nitro/Predator and Gift-bearing tables still fail closed before RNG with POLICY_PENDING. Probabilities have not been normalized, filtered or redrawn. Chest tier policy, actual object contact, final discovered visibility and Gift workflow remain gated. Binary protocolv1 and production mutation guard are unchanged.

[Frontend handoff with actual APIs/states/acceptance](FRONTEND_REWARD_HANDOFF_2026-10-14.md) is ready for the assigned frontend agent. Modal/carousel/buttons, map objects and their browser acceptance are NOT claimed.

## Validation and evidence

Windows, Node24.19.0, PostgreSQL16.15 loopback r2pl_prep_test_current. Strict compile, Biome check and client build PASS; full serial PostgreSQL regression114/114 PASS,0 skipped,20.09s. Seven new tests cover HTTP→wallet→WebSocket spending, restart/replay, token/field/origin/body/cursor boundaries, private events/catalog, global key collision,16 same-key requests, two-actor Chest race, Key net-zero detail, outbox rollback, overflow and a real child process exit86 after commit before caller receipt. Transport/catalog/inventory/events are exercised against real local HTTP endpoints.

Logs: [typecheck](benchmarks/bots/completion02-final-0.log), [lint](benchmarks/bots/completion02-final-1.log), [full regression](benchmarks/bots/completion02-final-2.log), [client build](benchmarks/bots/completion02-check-2.log). Existing2 observer.html informational style notes and >500kB bundle warning remain. Bundle is unchanged808.83kB/gzip216.40kB because the transport is not yet mounted by the main UI. No capacity/GPU/normal-UI reward claim. Size review: playable-rewards.test.ts exceeds400 lines but remains one cohesive fixture/network/transaction invariant suite; production service responsibilities are separated into wallet adapter, provisioning, HTTP boundary and pure contract modules.

npm run demo:play-rewards executes the actual authenticated HTTP/client transport and WebSocket loop in a random campaign, then deletes only its fixtures. Observed: credits1000→1002 on fixed Chest, Key1→0; same request returns replay; explore commits to1001; one private event; Nitro/Predator pending. This is a synthetic CLI integration demo, not a browser feature.

The previously launched dev server was identified by its owned ChildProcess handle(PID3200, exact play-schools import), confirmed bots finished, and restarted with the new source. Persistent HCMUT balance999 was preserved; inventory returned credit999/crystals0/maps0/Key1, ledgerConserved=true, four own targets; backend and bots running on4176. [Read-only live API evidence](benchmarks/bots/completion02-live-api.json). No persistent Chest was consumed by this check.

## Contribution, limits and next action

Codex: wallet/transaction integration, HTTP controller, account projection, minimal transport/shared contracts, disposable SQL, tests and CLI evidence. Exact runtime model ID not exposed(GPT-6 based). External agent worktrees unchanged. Orchestrator agents_status/system_status both returned Session terminated; no Antigravity/MiMo execution or model substitution is claimed.

AGENTS assigns client presentation to Antigravity in an isolated worktree. Because that tool is unavailable, its UI task is unimplemented; the next step is restore the configured agent or an explicit owner reassignment of the bounded inventory/reward panel. No permission is needed for the completed backend increment. Rule decisions, running API and production rollout remain separate. [Updated completion state](COMPLETION_PROGRESS.md).

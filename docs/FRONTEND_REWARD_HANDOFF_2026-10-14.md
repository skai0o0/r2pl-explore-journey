# Frontend handoff — synthetic account/reward slice

Date2026-10-14. Backend scope is implemented and verified; normal gameplay UI presentation is PENDING. Assigned frontend owner: Antigravity under AGENTS. Bridge currently returns Session terminated; do not claim this handoff as implemented UI or substitute a model.

## Reviewable scope

Integrate an inventory panel and reward target actions into the existing eight-school Three.js page. Keep existing world renderer, school selector and exploration. No new framework or production rules. Suggested bounded files: client/src/main.ts, client/src/rewardsPanel.ts, client/index.html, client/src/style.css. Read-only contracts: client/src/rewardClient.ts, shared/rewards/playable.ts, shared/rewards/commands.ts, shared/integration/devSession.ts. Do not edit server/shared rules, V1, production data, credentials or other worktrees.

## Available transport and data

Create DevRewardClient using the selected synthetic player's token. All methods are same-origin and authenticated; no binary opcode change.

- inventory(): credits, crystals, treasureMaps, keys; all canonical integer strings.
- catalog(): own discovered targetId/kind/profile, policyPending, claimed, available, nextAvailableAtMs.
- apply(command): committed/replay plus validated durable receipt. Construct kind use_unistop/open_chest, targetId from catalog, UUID key, ruleVersion fixture-rewards-v1. Keep same key and payload on uncertain retry; never regenerate a key to recover an unknown result.
- events(after): at most50 own actor committed events, each stable event ID and receipt, nextCursor. Persist cursor per selected actor, not globally across school/player changes. Replaying events must not replay business effects or duplicate toasts.

Fixture point rewards use the existing fixture-credit exploration wallet; no production Point/Crystal conversion. Opening Key1 is an explicit starter fixture only. catalog includes own school's Aspire/Nitro/Predator and a finite shared Chest with fixed Points2. Nitro/Predator return POLICY_PENDING before RNG and are visibly unavailable. Starter discoveries are synthetic grants; map geometry/reachability and production access are not implemented here.

## User flow and states

1. Account panel displays four balances. Keep Points-like test credit labeling explicit; avoid implying running-derived Points or real Gifts.
2. Action panel lists own discovered targets only. Show target type, remaining cooldown/claimed/pending reason, and required Key for Chest. Missing/hidden target responses must not reveal another actor or school.
3. Action sets pending/disabled until the authoritative receipt; animation is presentation only. Applied result displays actual grant, then refreshes inventory and existing credit HUD.
4. Rejected result explains COOLDOWN, KEY_REQUIRED, NOT_AVAILABLE or POLICY_PENDING without spending or fake success.
5. Network failure keeps the command for same-key retry; reload/reconnect recovers balances, catalog and events. A receipt replay renders the same result.
6. Changing selected actor immediately clears inventory, target list, pending display and old receipt; late requests/events from the previous actor are ignored via generation guard.
7. in-game event toast is actor-private and deduplicated. An actor can view own historical receipt after a target is consumed.

## Acceptance

Real browser: open Chest from1000 credit/Key1 →1002/Key0; explore a fresh tile →1001; retry/reload does not subtract another Key or regrant. Aspire gives exactly the persisted server draw, then cooldown. Second human actor at same school sees shared Chest consumed but retains own Key and receives no other actor's event. Different school's targets/history stay absent. Forged request/change payload is handled as an error, not success. Mobile panel fits agreed viewport and has accessible buttons, loading/reduced motion and clear disabled states.

Backend and transport have114 passing regression tests. UI screenshots/E2E are still required and cannot be inferred from those tests.

## Superseding owner update

On2026-10-14 the owner authorized Codex to implement frontend directly without Antigravity. The inventory/reward panel is now integrated; see [increment03](COMPLETION_INCREMENT_03_2026-10-14.md) for implementation, passing tests and pending browser mutation acceptance. Historical assignment notes above do not block Codex presentation edits.

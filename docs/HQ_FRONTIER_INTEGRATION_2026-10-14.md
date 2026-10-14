# HQ and frontier integration — 2026-10-14

The owner identified a missing core gameplay invariant and authorized integration: schools start with owned HQ area and expand only through adjacent tiles. Earlier playable builds enforced four-edge planning only in bots, not in the server. The completion plan omitted explicit HQ seed/frontier acceptance. This was an implementation and planning gap, not a feature already delivered.

## Current playable behavior

Eight non-overlapping development HQs, each20×20 (400 tiles), use the latest Gamenote footprint. Coordinates are synthetic public fixtures: centers(472,472),(512,472),(552,472),(472,512),(552,512),(472,552),(512,552),(552,552). Each HQ is recorded atomically with campaign creation as initial revision-zero Knowledge and own-school fog. No actor is charged; restarting does not seed again or overwrite exploration. Other HQs are protected from development exploration. Placement/footprint are not signed production map approval.

A fresh tile must share a north/south/east/west edge with CURRENT Knowledge of the authenticated actor school. Diagonal contact, opponent-only Knowledge and arbitrary clicks do not qualify. Known/discovered tiles still return no_change at zero cost. Server checks public HQ protection and durable neighbor masks inside the same transaction as credit debit, world update, command receipt and outbox. Target and neighbor chunk heads are locked in ascending chunk-ID order, including cross-chunk neighbors. At most three chunk heads are involved. Replay retains the original rejection/applied/no_change receipt even after the frontier changes. No hidden neighbor masks are sent to the client; wire rejection remains existing INVALID_COMMAND.

Client uses its private replica to disable outside-frontier actions, subscribes to selected-tile neighbor chunks, shows all eight HQ markers/models at current positions, and explains initial HQ ownership. Server remains the authority against fabricated commands. Bot planners learn the400 HQ tiles from actual snapshots and avoid other public HQ footprints. Growth can still overlap other schools outside HQ; full Shared/upkeep rules remain unimplemented. Existing historical M3/benchmark and play:local harnesses remain unrestricted fixtures; the eight-school player build at4176 always supplies the expansion boundary.

## Campaign/version boundary

New default campaign:94000000-0000-4000-8000-000000000000, code school-play-expansion-v1. Previous93000000 campaign and its wallets/world are preserved untouched; no old islands are silently migrated or erased. New campaign starts human test credits1000 and Key1. Binary protocol v1 and existing fixture-credit opcode/ruleVersion0 are byte-compatible; expansion fixture policy is identified by campaign code and validated HTTP bootstrap adjacentOnly/headquarters/campaignId. Pending reward commands/cursors/receipts are now namespaced by campaign and actor, so old recovery cannot execute in the new campaign.

## Verification

Windows local development, Node strip-types, PostgreSQL16 loopback, isolated synthetic test campaigns. **124/124 tests PASS, zero skipped**, full-run elapsed24.994s. [Log](benchmarks/completion/expansion-tests-2026-10-14.log). Strict TypeScript and Biome pass; two pre-existing observer informational notes remain. Vite build passes (JS824.65kB/gzip221.47kB; existing large-chunk warning).

Focused acceptance covers map corners/no row wrapping/no diagonals,400 own-only HQ mask+fog per school, initial no-charge HQ, opponent anchor refusal, protected HQ, far refusal/no debit, original rejected-key replay after frontier changes, continuous cross-chunk growth, same-school two-actor race charged once, real WebSocket fabricated far-command refusal, and restart preserving both balance and expansion. Bootstrap tests reject overlapping/out-of-bounds HQs, duplicate schools and invalid campaign scope. Recovery test proves campaign isolation.

Browser at4176 visibly shows owned starting HQ, correctly positioned models and outside-frontier disabled action on tile488/436 with credit1000 unchanged. [Screenshot](screenshots/hq-frontier-2026-10-14.png). Inventory also shows credit1000/Key1 in this new campaign. During browser verification a native-fetch receiver failure surfaced; default reward transport now calls fetch through a wrapper, with a focused regression test. No reward spend was performed to bypass the earlier approval rejection.

Live checkpoint:24 bots across all8 schools reported active growth and zero rejected actions. This is a local smoke observation, not a launch/capacity benchmark. Server remains running at http://127.0.0.1:4176/.

## Plan correction and remaining gates

Added mandatory HQ→frontier acceptance before higher-level gameplay. Found gaps remain explicit: public object contact/discovery for rewards is currently a starter grant, Shared/Knowledge lifecycle is only pure candidates/fixture overlap, Landmark is a visual placeholder, eight HQs reuse V2 placeholder artwork, production mapping/world/rule freeze/provider/Gifts/capacity remain pending. These are PARTIAL/NOT DONE rather than hidden under foundation test counts. G-V1 is not achieved; owner review applies to this improved playable build.

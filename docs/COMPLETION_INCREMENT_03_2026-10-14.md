# Completion increment03 — inventory/reward UI — 2026-10-14

Owner reassigned all development to Codex without Antigravity. Codex implemented the existing Three.js UI integration on branch codex/m4a-playable; no external agents or substitute models were used. This build is reviewable, but browser reward mutation acceptance remains pending as described below. It is not G-V1 completion or production launch approval.

## Delivered

- Native accessible inventory dialog: test credits, Crystals, Treasure Maps, Keys; Aspire and fixed Chest actions; explicit Gift policy pending for Nitro/Predator. Server catalog controls availability and cooldown. Starter targets are synthetic access grants, not production world discovery/contact.
- Actor-scoped pending UUID command stored before sending. Uncertain results survive reload and retry the identical payload. Receipt, event cursor and recovery storage are scoped by actor. No optimistic grants. Late responses are discarded across actor generations; old completions cannot delete a newer pending command after switching away and back.
- Authoritative inventory refresh after reward processing and exploration profile refresh. Profile request ordering prevents older reads from overwriting newer results. Dialog blocks map keyboard shortcuts; polling preserves focused target buttons. All server text is rendered with textContent.
- Responsive cards, native modal focus/escape handling, explicit synthetic labeling. Existing binary protocol v1, database schema and gameplay rules unchanged.

## Verification

Windows local development; Node strip-types, PostgreSQL16 loopback disposable test database, synthetic actors only. Strict TypeScript passes. Biome check passes with the two pre-existing observer useTemplate informational notes. Vite build passes: JS820.91kB / gzip220.34kB; existing large chunk warning remains.

Full PostgreSQL/network suite: **119/119 PASS, zero skipped**, elapsed20.849s. [Test log](benchmarks/completion/increment03-tests-2026-10-14.log). Five new frontend-session tests cover uncertain response/reload replay, late reward isolation, stale catalog/cursor across A→B→A, blocked/keyless actions and old completion vs newer pending command. Existing real HTTP/DB tests continue to verify grants, Key spending, cooldowns, duplicate replay, reward→exploration balance and crash recovery in owned disposable campaigns.

Browser verified at http://127.0.0.1:4176/: DTU Explorer1 and Explorer2 each show1000 test credits, Key1, no private receipt; reload preserves selected actor; Gift actions disabled. Native dialog renders on desktop and the narrow breakpoint (requested390×844 viewport; actual DOM433px wide due browser scaling). Dialog has no horizontal overflow; vertical scrolling reaches Đồng bộ. Viewport override was reset. [Desktop screenshot](screenshots/rewards-ui-2026-10-14.png), [mobile screenshot](screenshots/rewards-mobile-2026-10-14.png).

Automatic approval review rejected the browser “Mở Chest” action because it durably spends Key and grants credit in the persistent development campaign without explicit approval for this spend. The action was not retried through another path. Browser mutation journeys (Chest→HUD→fresh exploration, Aspire cooldown, reload after reward) remain **pending**, although disposable backend and recovery-model regression pass. To complete this browser acceptance, the owner must authorize spending synthetic Key/test resources in this local development campaign.

## Remaining scope

Production Gifts/policies, real campaign/Running adapters, full world contact, eight HQ artwork, Knowledge sharing/upkeep, Landmark flows, editor/admin and the rest of the parity checklist remain open. [Current progress](COMPLETION_PROGRESS.md) retains these gates.

# R2PL Game V2 — Agent Operating Instructions (UNBLOCKED EXECUTION MODE)

## 1. Executive Override & Authority (Effective Immediately)

- **FULL IMPLEMENTATION AUTHORIZATION:** The Product Owner explicitly authorizes immediate, end-to-end implementation of all gameplay, UI, world objects, rewards, landmarks, shared knowledge, leaderboards, notifications, and admin editor features toward full V1 parity (**G-V1**) and campaign readiness.
- **SIGNED RULE VERSION 1 ACTIVE:** `docs/GAME_SPEC.md` is now the **signed, approved `ruleVersion = 1`** specification. All historical `PENDING`, `BLOCKED`, `M4-D0 docs-only`, `NOT A SIGNED PRODUCTION RULE VERSION`, and `C-01..C-13` conflict gates in `docs/` are **SUPERSEDED AND CLOSED**.
- **CONFIG-FIRST, NEVER BLOCK:** Put all numeric gameplay parameters (costs, timers, footprints, thresholds, loot tables, cooldowns) in a central, strongly-typed configuration module (`shared/gameplay/gameConfig.ts`). Never halt, stub out, or block a feature over a numeric question—use the approved `ruleVersion = 1` defaults in `docs/GAME_SPEC.md`.
- **UNRESTRICTED LOCAL/DEV & BROWSER TESTING:** You are explicitly authorized to spend synthetic Points, Credits, Crystals, Keys, open Chests, spin UniStops, light Landmarks, and mutate campaign state during automated tests and real-browser verification on local/dev/staging campaigns without asking for permission.
- **DIRECT V1 UI & MODULE PORTING AUTHORIZED:** `land-rush-prototype` (V1) is an approved source for porting UI components, modals, Three.js scene helpers, landmark data, and client workflows. Actively port and adapt V1 UI modules (`landmarkModal.ts`, `uniStopModal.ts`, `carouselModal.ts`, `miniMap.ts`, `statsOverlay.ts`, `mapEditorPanel.ts`, `studentActionDock.ts`, `tileTooltip.ts`, `notificationBanner.ts`) into `client/src/` and wire them to V2's authoritative server/PostgreSQL backend.
- **SINGLE-AGENT DIRECT EXECUTION:** Implement all `shared/`, `server/`, `client/`, `database/`, and `tests/` changes directly. Do not invoke external agent CLIs (`Antigravity`, `MiMo`) or wait for external reviews.

## 2. Anti-Bureaucracy Rules (Strict Enforcement)

1. **NO NEW MARKDOWN REPORTS:** Do **NOT** create any new `.md` files in `docs/` (no more increment reports, readiness audits, alignment worksheets, or conflict registers). Update only the status table in `COMPLETION_PROGRESS.md` when a full feature journey is completed.
2. **FREEZE INFRASTRUCTURE BENCHMARKS:** M1–M3.6 world/realtime/PostgreSQL foundations are accepted. Do **NOT** run new 1,000-client hotspot load tests, CPU profiling, or outbox microbenchmarks until all 18 player/operator journeys (PV01–PV18) are 100% playable in the browser.
3. **SHIP END-TO-END VERTICAL FEATURES:** Every task must wire `shared/ config & rules` -> `server/ PostgreSQL transaction & route` -> `client/ Three.js + UI modal` -> `focused integration test`. Do not ship dead pure functions or unmounted backend endpoints.

## 3. Technical Architecture Guardrails

- **Stack:** Strict TypeScript, Colyseus 0.18.x, Three.js, PostgreSQL, Vite.
- **Server Authority:** Server validates identity, adjacency, cooldowns, balances, and permissions inside PostgreSQL transactions before acknowledging mutations.
- **World & Visibility:** 1000x1000 grid, 16 school slots (slots 0–7 mapped to the 8 confirmed universities), own-school fog bitsets. Never broadcast raw rival school masks or private player wallets/discoveries to unauthorized clients.
- **External Running API Boundary:** Keep external running/portal verification behind a clean provider interface (`CampaignProvider`) with a working local/staging synthetic provider so all features (including weekly running Gift eligibility and Points conversion) can be played and tested end-to-end locally.

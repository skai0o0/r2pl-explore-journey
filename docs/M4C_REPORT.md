# M4-C closure report

**Audit date:** 2026-10-11  
**Reviewed HEAD:** `3d74506a736f5ab81dd42d544717809a8a68fffc` (`codex/m4a-playable`)  
**Status:** **M4-C code delivered, final visual E2E acceptance pending.** This report closes the code audit only. It does not approve a production gameplay rule, authorize M5, or make a production-readiness claim.

## Implementation summary

M4-C is the presentation and interaction increment from the M4-B playable development baseline (`e7f2d9a..3d74506`). Commit `36f7583` added local, replaceable HQ/Landmark glTF fixtures and a loader/mount lifecycle; commit `3d74506` finalized isometric/top-down interaction, projected tile indicators, camera-correct picking and a client-side synthetic-credit guard. It retains the existing protocol-v1, loopback-only, server-authoritative M4-A/M4-B path.

- `client/src/assetRegistry.ts:1-42` declares swappable local model URLs and synthetic placements; `client/public/models/hq.gltf` and `client/public/models/landmark.gltf` are self-contained fixture assets.
- `client/src/assetLoader.ts:5-59` caches template requests and clones geometry/material resources per scene instance. `client/src/assetPipeline.ts:10-85` applies placements, preserves a fallback on load failure and disposes model resources.
- `client/src/worldView.ts:27-108` defines exact bigint credit-state parsing, orthographic camera configuration, ground picking and tile projection. `client/src/worldView.ts:140-198` implements a constant-resource indicator layer. `client/src/worldView.ts:408-461` mounts fixture models with visible depth supports; `client/src/worldView.ts:537-547` toggles isometric/top-down modes; `client/src/worldView.ts:810-846` maps pointer/screen coordinates through the camera; `client/src/worldView.ts:1005-1029` synchronizes projection and rendering.
- `client/src/main.ts:84-99` derives the synthetic-credit guard from server profile values; `client/src/main.ts:283-303` updates camera accessibility/status text; `client/src/main.ts:316-338` prevents a known unaffordable client request; `client/src/main.ts:510-529` exposes keyboard camera switching. Server validation and the durable transaction remain authoritative.
- `tests/m4c-asset-pipeline.test.ts:20-145` covers credit states, projection/picking in both camera modes and constant indicator resources; `tests/m4c-asset-pipeline.test.ts:147-254` covers registry/fixture validity, loader isolation and fallback lifecycle.

No server, shared gameplay, protocol, database schema, production data or approved rule was changed by M4-C. The model locations, school identities, resource label and cost remain synthetic development fixtures.

## Requirement traceability

| Requirement / boundary | Evidence | Audit result |
|---|---|---|
| Improve the playable presentation without one object per world tile | Projected, reusable indicator objects and batched existing chunk layers in `worldView.ts:140-198, 984-1029`; 10,000 indicator updates tested in `m4c-asset-pipeline.test.ts:98-145` | Code-covered; GPU/frame behavior still unverified |
| Swappable local 3D fixture assets with safe failure behavior | Registry, cached isolated instances and fallback/disposal at `assetRegistry.ts:1-42`, `assetLoader.ts:5-59`, `assetPipeline.ts:10-85` | Code-covered; visual quality still unverified |
| Accurate tile interaction in top-down and isometric views | Camera/picking functions at `worldView.ts:43-108, 810-846`; multi-view round trips at `m4c-asset-pipeline.test.ts:34-96` | Pure tests pass; real-browser interaction still unverified |
| Client feedback may block obviously unaffordable fixture actions, but cannot become authority | `main.ts:84-99, 316-338`; server profile values feed the guard and the existing server path remains authoritative | Development-only guard; no gameplay approval |
| Preserve M4-A/M4-B architecture and rule boundaries | M4-C diff changes client/assets/pure client tests only; protocol v1 and server/database code are unchanged | Satisfied by diff review |
| Do not infer production rules | `GAME_SPEC.md` and `SPEC_CONFLICTS.md` still mark relevant rules pending; candidates remain inactive | Satisfied; owner decisions remain blocking |

## Verification evidence

The following results were recorded by the technical lead immediately before this documentation pass on Windows, Node.js `v24.19.0`, HEAD `3d74506`. They were not independently rerun during this documentation-only execution:

| Command | Observed result | Comparison / limitation |
|---|---|---|
| `npm run typecheck` | PASS, exit 0 | Matches M4-A/M4-B strict-compilation pass |
| `npm run lint` | PASS, exit 0; 60 files | Matches prior lint gate; file count now recorded |
| `node --experimental-strip-types --test tests/world-foundation.test.ts tests/m4b-gameplay.test.ts tests/m4c-asset-pipeline.test.ts` | PASS, 38/38 | Focused pure suite adds M4-C camera, indicator, credit guard and asset lifecycle coverage; it is not the historical M4-B PostgreSQL 52/52 suite |
| `npm run build:client` | PASS; Vite 8.3.4, 65 modules; JS 807.27 kB / 215.92 kB gzip; CSS 12.40 kB / 3.58 kB gzip | JS increased from M4-B 714.91 kB / 190.55 kB gzip; CSS gzip matches M4-B. Existing >500 kB bundle risk remains |

Historical M4-A browser/PostgreSQL and M4-B two-session/PostgreSQL evidence remains useful regression history, but is not fresh M4-C acceptance evidence. PostgreSQL integration was **UNVERIFIED** in this execution and no database test or operation was run. Real-browser desktop/mobile interaction and GPU/frame-time/memory performance were also **UNVERIFIED**. No capacity claim follows from pure tests or a production build.

## Manual UX / browser acceptance gate

- [ ] Desktop browser: load the loopback fixture, verify HQ/Landmark models or fallbacks are visible and correctly anchored in both camera modes.
- [ ] Desktop browser: pan, zoom, hover, select and explore at center/edges; verify pointer-to-tile accuracy and all hover/selected/pending/reveal/reject indicators.
- [ ] Keyboard/accessibility: toggle with `I`, verify focus behavior, labels/status announcements and that controls do not trigger unintended map actions.
- [ ] Mobile/narrow viewport: touch pan/select/explore, zoom controls, HUD wrapping and camera toggle without clipped or obstructed controls.
- [ ] Two-session delivery/reload: verify committed knowledge appears to the same school, no-change costs zero, and reload/reconnect restores state.
- [ ] Synthetic-credit boundary: known insufficient balance disables/prevents the client request while unknown profile state fails open to authoritative server validation.
- [ ] Asset failure path: unavailable model URL retains the fallback and leaves interaction usable.
- [ ] GPU/performance: record named device/browser, overview and hotspot frame time, draw calls, heap/GPU memory and long-pan stability.

The manual visual E2E gate is unmet until these checks are executed and recorded. The independently prepared [`M4C_UX_VERIFICATION.md`](M4C_UX_VERIFICATION.md) provides a source/automated UX audit and an execution checklist; it also marks live M4-C rendering and screenshots unverified, so it does not close this gate.

## Defects, blockers and risks

- **Acceptance blocker:** no fresh real-browser desktop/mobile visual E2E evidence for M4-C and no GPU measurement.
- **Production launch blocker:** M3.6 hotspot delivery remains unresolved (historical 1,000-client/250-actions/s hotspot ACK p95 4.71-5.40 s and visible p95 24.82-25.08 s). It may proceed in parallel with development but blocks launch claims.
- **Bundle risk:** the 807.27 kB JavaScript chunk is above Vite's warning threshold and is larger than M4-B; loading/caching impact needs browser measurement.
- **Fixture risk:** current glTF geometry, supports, placements, universities, credits and one-credit behavior are synthetic and must not be treated as campaign content or balance.
- **Evidence gap:** PostgreSQL integration was not rerun, so M4-C relies on unchanged-boundary review plus historical M4-A/M4-B durable-path evidence.
- **Decision blockers:** C-01/C-03/C-08 gate competitive Knowledge and its visibility; C-02/C-09 gate Landmark behavior/content; C-04 gates production roster/HQ layout; C-12 gates full-map scoring/leaderboards. No candidate value is approved by this report.

## Closure statement

**M4-C code delivered, final visual E2E acceptance pending.** M4-D0 is a decision-freeze planning stage only and is not yet owner approved. Do not activate candidate contest, decay, Landmark, scoring, reward or production visibility rules until the applicable owner decisions are recorded in the authoritative specification documents.

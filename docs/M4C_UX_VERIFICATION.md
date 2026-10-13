# M4-C UX & Interactions Verification Report

**Review Date:** 2026-10-11  
**Target Milestone:** M4-C (Isometric Interactions, 3D Asset Pipeline, and UX Refinement)  
**Evaluated Commits:** `3d74506` ("M4-C: finalize isometric interactions and dev credit guard") and `36f7583` ("fix M4-C0.1 model fixture rendering")  
**Reviewer:** Antigravity (Evidence-Based Acceptance Review)

---

## 1. Executive Summary & Status Overview

This report provides an evidence-based acceptance audit of the M4-C UX, interaction, and visual subsystem. The verification methodology strictly distinguishes between **automated test executions**, **static source code analysis**, and **live browser visual verification**.

Per strict task constraints, **no dev server, database migrations, or browser processes were launched** during this session. Consequently, all visual rendering aspects are audited from source and marked as **UNVERIFIED in this session** pending manual browser smoke execution.

### Overall Subsystem Status

| Subsystem / Feature | Evaluation Method | Exact Citations | Verdict |
| :--- | :--- | :--- | :--- |
| **Camera Pan / Zoom (Isometric & Top-down)** | Automated Test & Source Audit | [worldView.ts:25-74](../client/src/worldView.ts#L25-L74), [tests/m4c-asset-pipeline.test.ts:34-96](../tests/m4c-asset-pipeline.test.ts#L34-L96) | **PASS** |
| **Click / Tap Ground Picking & 3D Reticles** | Automated Test & Source Audit | [worldView.ts:76-84, 140-209, 811-838](../client/src/worldView.ts#L76-L84), [tests/m4c-asset-pipeline.test.ts:98-146](../tests/m4c-asset-pipeline.test.ts#L98-L146) | **PASS** |
| **HQ & Landmark 3D Model Pipeline** | Automated Test & Source Audit | [assetRegistry.ts:1-42](../client/src/assetRegistry.ts#L1-L42), [assetLoader.ts:37-59](../client/src/assetLoader.ts#L37-L59), [assetPipeline.ts:40-85](../client/src/assetPipeline.ts#L40-L85), [tests/m4c-asset-pipeline.test.ts:148-254](../tests/m4c-asset-pipeline.test.ts#L148-L254) | **PASS** |
| **Fog of War & Reveal Presentation** | Source Audit | [worldView.ts:249-296, 641-658, 732-779](../client/src/worldView.ts#L249-L296) | **PASS** (Source) / **UNVERIFIED** (Live session) |
| **Insufficient Credit Feedback Guard** | Automated Test & Source Audit | [worldView.ts:29-37](../client/src/worldView.ts#L29-L37), [main.ts:89-97, 326-330](../client/src/main.ts#L89-L97), [tests/m4c-asset-pipeline.test.ts:20-32](../tests/m4c-asset-pipeline.test.ts#L20-L32) | **PASS** |
| **Mobile UI & Touch Gestures** | Source Audit & Existing Assets | [style.css:852-987](../client/src/style.css#L852-L987), [worldView.ts:869-897](../client/src/worldView.ts#L869-L897), [docs/screenshots/m4a-dawn-mobile.jpg](../docs/screenshots/m4a-dawn-mobile.jpg) | **PASS** (Source) / **UNVERIFIED** (Live session) |
| **Accessibility & Keyboard Navigation** | Source Audit | [index.html:11-47](../client/index.html#L11-L47), [main.ts:294-304, 499-539](../client/src/main.ts#L294-L304) | **PASS** |
| **Reconnection & State Resynchronization** | Source Audit | [main.ts:378-412, 448-464](../client/src/main.ts#L378-L412) | **PASS** |
| **Visual Smoke Test Artifacts** | Artifact Inspection | [docs/screenshots/](../docs/screenshots/) | **UNVERIFIED** (M4-C screenshots pending) |

---

## 2. Test Execution & Evidence

### 2.1 Automated Test Execution (Executed)
The safe, non-destructive test suite was run without touching database or tracked files:
```powershell
node --experimental-strip-types --test tests/m4c-asset-pipeline.test.ts
```
**Results:**
- Total Tests: 7 passed, 0 failed, 0 skipped (Duration: ~151 ms)
  1. `dev credit state only blocks a known positive unaffordable cost` ([tests/m4c-asset-pipeline.test.ts:20](../tests/m4c-asset-pipeline.test.ts#L20)): Validated boundary conditions, non-numeric strings, 0-cost free actions, and large integer balances.
  2. `camera projection, tile corners, and ground picking agree in every view` ([tests/m4c-asset-pipeline.test.ts:34](../tests/m4c-asset-pipeline.test.ts#L34)): Validated round-trip agreement across 4 aspect ratios (16:9, 1:1, 9:16, 2.4) in both `top-down` and `isometric` modes with error tolerance `< 1e-7`.
  3. `tile indicators reuse constant scene resources without WebGL` ([tests/m4c-asset-pipeline.test.ts:98](../tests/m4c-asset-pipeline.test.ts#L98)): Proved constant geometry (2) and material (10) resource retention over 10,000 indicator updates without creating new indicator geometry/material objects; actual heap/GC behavior was not measured.
  4. `model registry uses local swappable URLs and preserves world locations` ([tests/m4c-asset-pipeline.test.ts:148](../tests/m4c-asset-pipeline.test.ts#L148)): Verified fixture URLs and coordinate anchors for Dawn HQ, Dusk HQ, and Landmark.
  5. `fixture glTF files are self-contained glTF 2.0 geometry` ([tests/m4c-asset-pipeline.test.ts:167](../tests/m4c-asset-pipeline.test.ts#L167)): Validated glTF 2.0 schema, embedded base64 buffers, and camera-facing polygon surface normals (`normal.z > 0`).
  6. `loader deduplicates requests and returns isolated scene resources` ([tests/m4c-asset-pipeline.test.ts:207](../tests/m4c-asset-pipeline.test.ts#L207)): Proved concurrent request deduplication and geometry/material isolation between clones.
  7. `placement conversion and fallback lifecycle do not require WebGL` ([tests/m4c-asset-pipeline.test.ts:232](../tests/m4c-asset-pipeline.test.ts#L232)): Proved coordinate offset translation and graceful fallback retention upon network load failures.

---

## 3. Detailed Feature Audit & Code Citations

### 3.1 Camera Pan / Zoom & Topdown-Isometric Modes
- **Implementation:** [`configureMapCamera`](../client/src/worldView.ts#L43-L74) configures an orthographic camera with near=0.1, far=4000.
  - In `isometric` mode: `up.set(0, 0, 1)`, positioned at `(targetX + 900, targetY - 900, 1116)` looking at `(targetX, targetY, 0)` ([worldView.ts:60-66](../client/src/worldView.ts#L60-L66)).
  - In `top-down` mode: `up.set(0, 1, 0)`, positioned at `(targetX, targetY, 1800)` ([worldView.ts:67-70](../client/src/worldView.ts#L67-L70)).
  - Camera mode toggles via [`toggleCameraMode()`](../client/src/worldView.ts#L541-L547) or keyboard shortcut `I` ([main.ts:522-526](../client/src/main.ts#L522-L526)).
- **Pan / Drag Interaction:** Mouse/pointer drags convert delta client pixels into ground plane hits via [`groundPointFromNdc`](../client/src/worldView.ts#L76-L84) on plane `z=0` ([worldView.ts:41](../client/src/worldView.ts#L41)), maintaining exact 1:1 ground tracking under both camera angles ([worldView.ts:900-912](../client/src/worldView.ts#L900-L912)).
- **Zoom Interaction:** Mouse wheel listener maintains focal point under cursor ([worldView.ts:967-984](../client/src/worldView.ts#L967-L984)); pinch gestures track multi-touch distance ([worldView.ts:886-897](../client/src/worldView.ts#L886-L897)).
- **Verdict:** **PASS**

### 3.2 Click / Tap Picking & Tile Indicators
- **Picking Logic:** Pointer clicks evaluate client coordinates against the Three.js ground plane ([worldView.ts:811-838](../client/src/worldView.ts#L811-L838)). Tile index and chunk coordinates are extracted deterministically via `tileIndex(x, z)` and `chunkId(chunkX, chunkZ)` ([worldView.ts:945-958](../client/src/worldView.ts#L945-L958)).
- **In-Scene Indicators:** Commit `3d74506` eliminated misaligned 2D DOM reticle boxes in favor of in-scene 3D planar and outline indicators ([`TileIndicatorLayer`](../client/src/worldView.ts#L140-L209)). Supported indicator states include `hover`, `selected`, `pending`, `reveal`, and `reject` ([worldView.ts:114-128](../client/src/worldView.ts#L114-L128)).
- **Resource Reuse:** The indicator layer instantiates exactly 2 shared geometries and 10 materials, avoiding per-pointer indicator geometry/material allocation; actual GC behavior still requires browser measurement ([worldView.ts:141-184](../client/src/worldView.ts#L141-L184), tested in [tests/m4c-asset-pipeline.test.ts:98-146](../tests/m4c-asset-pipeline.test.ts#L98-L146)).
- **Verdict:** **PASS**

### 3.3 HQ & Landmark 3D Models
- **Registry & Placement:** Models are defined in [`MODEL_ASSETS`](../client/src/assetRegistry.ts#L1-L4) (`hq` and `landmark`) and positioned via [`MODEL_PLACEMENTS`](../client/src/assetRegistry.ts#L17-L42) at Dawn HQ `(215, 235)`, Dusk HQ `(785, 765)`, and Landmark `(510, 485)`.
- **Pipeline & Lifecycle:** [`mountModelAsset`](../client/src/assetPipeline.ts#L40-L85) mounts a procedural fallback immediately. Once glTF assets load via [`ModelAssetLoader`](../client/src/assetLoader.ts#L37-L59), the fallback geometry/materials are disposed of and the model is mounted.
- **Visual Depth Plinths:** In [`worldView.ts:412-432`](../client/src/worldView.ts#L412-L432), cylindrical base plinths (height 3 for HQ, height 5 for Landmark) provide visual depth and elevation for flat synthetic models in isometric projection.
- **Verdict:** **PASS**

### 3.4 Fog of War, Chunky Streaming & Reveal Presentation
- **Fog Base:** Procedural 1000x1000 texture created in [`foggedBaseTerrainPixels()`](../client/src/worldView.ts#L249-L296) with clear beacon clearings at Dawn HQ (r=16), Dusk HQ (r=16), and Landmark (r=22).
- **Dynamic Chunk Textures:** Discovered tiles are unmasked per school in [`#paintLocal`](../client/src/worldView.ts#L732-L779) using `replica.isDiscovered(id, local)` and `replica.maskAt(id, local)`.
  - Dawn ownership produces emerald mint territory tint ([worldView.ts:760-763](../client/src/worldView.ts#L760-L763)).
  - Dusk ownership produces warm coral glow ([worldView.ts:764-769](../client/src/worldView.ts#L764-L769)).
  - Scouted/unclaimed tiles display clean revealed terrain lighting ([worldView.ts:771-778](../client/src/worldView.ts#L771-L778)).
- **Reveal & Reject Feedback:** On server ACK, [`playReveal`](../client/src/worldView.ts#L641-L658) triggers an animated expanding ring and sparkle particle effect, backed by the 3D reveal reticle. Rejections trigger [`playReject`](../client/src/worldView.ts#L660-L676).
- **Verdict:** **PASS** (Source Audit) / **UNVERIFIED** (Live session)

### 3.5 Insufficient Credit Feedback Guard
- **Pure Evaluation Guard:** [`deriveDevCreditState(balance, cost)`](../client/src/worldView.ts#L29-L37) compares `BigInt(balance) >= BigInt(cost)`. Safely falls back to `"unknown"` if inputs are undefined or non-digit strings.
- **UI Guard Integration:**
  - [`lacksTestCredits()`](../client/src/main.ts#L89-L91) evaluates current profile state.
  - [`showInsufficientCredits()`](../client/src/main.ts#L93-L97) disables `#explore-button` and sets text to `"Not enough test credits"`.
  - [`explore()`](../client/src/main.ts#L326-L330) explicitly blocks exploration dispatch, preventing network round-trips when credits are insufficient.
  - Guard is wired to status updates ([main.ts:114](../client/src/main.ts#L114)) and tile selection updates ([main.ts:212-218, 227-233](../client/src/main.ts#L212-L218)).
- **Verdict:** **PASS**

### 3.6 Mobile UI & Touch Responsiveness
- **Touch Action:** `#world-view { touch-action: none; }` ([style.css:47](../client/src/style.css#L47)) delegates gestures directly to Three.js pointers.
- **Pinch Gestures:** Dual-pointer tracking in [`#pointerMove`](../client/src/worldView.ts#L886-L897) enables smooth mobile pinch-to-zoom.
- **Responsive Layout (`style.css`):**
  - `@media (max-width: 768px)` ([style.css:852-957](../client/src/style.css#L852-L957)): Compresses top bar to 56px, collapses verbose pill labels, repositions map tools, and anchors tile panel to bottom-right.
  - `@media (max-width: 480px)` ([style.css:959-987](../client/src/style.css#L959-L987)): Hides non-essential activity panel log, widens tile panel to full width, and scales typography for narrow screens.
- **Verdict:** **PASS** (Source Audit) / **UNVERIFIED** (Live session)

### 3.7 Accessibility & Navigation Controls
- **Screen Reader Announcements:** `#world-view` defines `role="application"` with dynamic `aria-label` updated on view toggle ([index.html:11](../client/index.html#L11), [main.ts:298-300](../client/src/main.ts#L298-L300)).
- **Semantic Structure:** Sections use semantic landmarks (`<header class="top-bar">`, `<aside class="identity">`, `<section class="resources">`, `<nav class="map-tools">`, `<section class="tile-panel">`).
- **Keyboard Shortcuts:** Configured in [`main.ts:499-539`](../client/src/main.ts#L499-L539):
  - `H`: Focus HQ
  - `L`: Focus Landmark
  - `O`: Focus Overview
  - `I`: Toggle Isometric / Top-down
  - `+` / `-`: Zoom In / Out
  - `Enter`: Explore selected tile
  - Guarded against input fields (`HTMLInputElement` / `HTMLSelectElement` in [main.ts:500-504](../client/src/main.ts#L500-L504)).
- **Verdict:** **PASS**

### 3.8 Reconnection & State Synchronization
- **Transport Resilience:** Uses Colyseus SDK with auto-reconnect timer (1200ms) on disconnect ([main.ts:448-454](../client/src/main.ts#L448-L454)).
- **State Recovery:** Applies full chunk snapshots on `M2_KIND.SNAPSHOT` ([main.ts:378-384](../client/src/main.ts#L378-L384)) and requests chunk resync on delta sequence mismatch ([main.ts:388-390](../client/src/main.ts#L388-L390)).
- **Pending Replay:** Replays queued in-flight explore commands upon reconnect ([main.ts:461-463](../client/src/main.ts#L461-L463)).
- **Verdict:** **PASS**

---

## 4. Visual Smoke Test Evidence & Inspection

### 4.1 Screenshots Directory Inspection
Inspection of `docs/screenshots/` reveals the following artifacts:
- `m4a-dawn-desktop.jpg` (M4-A baseline)
- `m4a-dawn-mobile.jpg` (M4-A baseline)
- `m4a-dusk-desktop.jpg` (M4-A baseline)
- `m4b-dawn-gameplay.png` (M4-B baseline)
- `m4b-dusk-gameplay.png` (M4-B baseline)

**Finding:** There are currently **no M4-C visual screenshot captures** (`m4c-*`) stored in `docs/screenshots/`. In accordance with instructions, live browser tests were not executed in this non-interactive inspection session.

---

## 5. Manual Browser Smoke Checklist (For Tester Execution)

The following checklist specifies exact reproduction steps to be performed against a disposable local fixture when the local dev server is launched:

> [!IMPORTANT]
> Do NOT use production or Supabase databases. Ensure `R2PL_DEV_PLAY=1` is configured.

### Step 1: Environment Startup
1. In a PowerShell terminal, start PostgreSQL 16 on loopback and set environment variables:
   ```powershell
   $env:R2PL_DEV_PLAY = '1'
   $env:R2PL_TEST_DATABASE_URL = 'postgresql://test_user:test_password@127.0.0.1:5432/disposable_db'
   npm run play:local
   ```
2. Confirm the local static client runs on loopback port 4173 and Colyseus on loopback port 2567.

### Step 2: Camera & Isometric Controls Smoke Test
1. Open `http://127.0.0.1:4173` in a desktop browser.
2. Verify initial view defaults to **Isometric 3D** centered on Dawn HQ `(215, 235)`.
3. Press `I` on the keyboard: verify camera smoothly switches to **Top-down** mode, and the expedition log displays `"Top-down camera · press I to toggle view"`.
4. Press `I` again: verify return to **Isometric 3D**.
5. Drag with the mouse: verify terrain pans smoothly without jitter or drift.
6. Scroll with mouse wheel: verify zoom centers around the mouse cursor.
7. Press `H`: verify smooth animated pan to Dawn HQ `(215, 235)`.
8. Press `L`: verify smooth animated pan to Landmark `(510, 485)`.
9. Press `O`: verify smooth animated zoom-out to complete 1000x1000 World Overview.

### Step 3: Model Assets & Plinth Inspection
1. Navigate to Dawn HQ `(215, 235)` and Landmark `(510, 485)`.
2. Verify 3D models render on top of their raised cylindrical plinths with visual elevation.
3. Switch between `Isometric` and `Top-down` to verify proper model orientation and depth.

### Step 4: Tile Picking & 3D Reticle Verification
1. Move the mouse across the terrain.
2. Verify the 3D hover reticle adheres exactly to the hovered tile grid quad in both isometric and top-down perspectives.
3. Confirm status strip displays accurate `CURSOR: XXX / ZZZ` coordinates matching the reticle.
4. Click on an unexplored tile. Verify the reticle switches to `selected` and `pending` state immediately.

### Step 5: Exploration Feedback & Fog Clearing
1. Click an unexplored fogged tile.
2. Verify explore button indicates `COMMITTING` with animated spinner.
3. Upon commit ACK:
   - Verify green expanding ring and sparkle particle animation trigger at the tile.
   - Verify tile updates from dark fog to vibrant emerald mint territory glow.
   - Verify balance decreases by 1 credit.
4. Click the same explored tile again:
   - Verify button displays `Already Explored · 0 credits`.
   - Verify no credit is deducted.

### Step 6: Insufficient Credit Guard Smoke Test
1. In the database fixture or by exploring until credits reach 0, verify the player balance shows `0`.
2. Click any unexplored tile:
   - Verify button shows `"Not enough test credits · Explore unavailable"` and is disabled.
   - Verify pressing `Enter` or clicking does not dispatch exploration frames.
   - Verify log states `"Not enough test credits to explore"`.

### Step 7: Dual-Tab Realtime Sync & School Fog Isolation
1. Open a second browser tab at `http://127.0.0.1:4173`.
2. In Tab 2, select **Dawn · Explorer 2**.
3. Explore a tile in Tab 1: verify Tab 2 reflects the new territory in real-time.
4. In Tab 2, switch explorer to **Dusk · Explorer 1**:
   - Verify Tab 2 camera moves to Dusk HQ `(785, 765)`.
   - Verify Dawn's explored territory remains completely shrouded in fog in Tab 2.

### Step 8: Mobile Viewport & Touch Interaction
1. Open Chrome DevTools and switch to Mobile Device emulation (e.g. iPhone 14 or Pixel 7, width < 480px).
2. Verify top bar compacts to 56px, identity panel shrinks, and tile exploration panel stretches horizontally across the bottom.
3. Use multi-touch pinch emulation to zoom in and out.
4. Verify tile picking and exploration work reliably via tap events.

### Step 9: Reconnection & Network Recovery
1. In DevTools Network tab, toggle **Offline**.
2. Verify connection status changes to `"Disconnected · reconnecting"` and `#retry-button` appears.
3. Toggle back to **Online** or click Reconnect:
   - Measure and record actual reconnection duration; no fixed SLA is verified.
   - Verify chunk snapshots refresh and player balance persists accurately.

---

## 6. Known Issues, Discrepancies & Recommendations

1. **Missing M4-C Visual Screenshot Captures:**
   - *Status:* Minor documentation gap.
   - *Detail:* `docs/screenshots/` retains M4-A and M4-B images, but no M4-C captures illustrating isometric models or 3D reticles have been saved yet.
   - *Recommendation:* Capture and commit `m4c-isometric-desktop.png` and `m4c-isometric-mobile.png` during the first manual browser smoke run.
2. **WebGL Context Requirement for Visual Testing:**
   - *Status:* Architectural constraint.
   - *Detail:* Unit tests (`tests/m4c-asset-pipeline.test.ts`) test mathematical projections, glTF geometry data, and asset deduplication headlessly, but cannot verify WebGL shader compilation or hardware antialiasing without a browser runtime.
3. **Synthetic Rule v0 Boundary:**
   - *Status:* Working as intended.
   - *Detail:* Exploration cost logic strictly uses development rule version 0 with fixture credits; real student auth and production rules remain disabled.

## 2026-10-13 browser smoke addendum

[New live browser evidence](M4C_BROWSER_SMOKE_2026-10-13.md) verifies desktop camera/model/navigation, durable exploration, two-session sync/no-change, reload and narrow-layout pointer exploration. Earlier UNVERIFIED statements above describe the 2026-10-11 audit session. Full acceptance remains pending physical touch/pinch, remaining visual scenarios and named-device GPU/frame/memory measurements. No mobile screenshot artifact is claimed because capture was unreliable.

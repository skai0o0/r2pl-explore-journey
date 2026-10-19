# R2PL Game V2 — Authoritative Game Specification (SIGNED ruleVersion = 1)

> **STATUS: APPROVED & FROZEN FOR FULL IMPLEMENTATION (`ruleVersion = 1`)**
> By Owner Directive (2026-10-14), all `C-01` through `C-13` decisions are resolved below for immediate end-to-end implementation. All parameters must be stored in `shared/gameplay/gameConfig.ts` so balances can be tuned via configuration without code rewrites. Historical `PENDING` or `DOCS-ONLY` notes in older files are superseded.

## 1. Confirmed School Roster & World Layout (`C-04`, `C-05`, `C-08`)

| **Slot Bit** | **School ID** | **Short Name** | **Full Name** | **Color Hex** | **Accent Hex** | **Staging HQ Center (x, z)** | 
| `0` | `hcmut` | HCMUT | Đại Học Bách Khoa_Hồ Chí Minh | `#0062FF` | `#00E5FF` | `(500, 280)` | 
| `1` | `ou` | OU | Đại Học Mở_Hồ Chí Minh | `#FF8C00` | `#FFD700` | `(655, 345)` | 
| `2` | `dtu` | DTU | Đại Học Duy Tân_Đà Nẵng | `#E60026` | `#FF4D6D` | `(720, 500)` | 
| `3` | `hpuni` | HPUNI | Đại Học Hải Phòng | `#00A86B` | `#00FF9D` | `(655, 655)` | 
| `4` | `hsu` | HSU | Đại Học Hoa Sen_Hồ Chí Minh | `#7928CA` | `#FF0080` | `(500, 720)` | 
| `5` | `huce` | HUCE | Đại Học Xây Dựng_Hà Nội | `#E7C547` | `#FFF0A0` | `(345, 655)` | 
| `6` | `ntu` | NTU | Đại Học Nha Trang | `#00B8D9` | `#80FFFF` | `(280, 500)` | 
| `7` | `hcmiu` | HCMIU | Đại Học Quốc Tế | `#E85D9E` | `#FFB8DD` | `(345, 345)` | 

* **Slots `8–15`:** Reserved in the 16-bit mask for late-joining universities via Admin onboarding.

* **Object Footprints (Configurable in `gameConfig.ts`):**

  * **HQ:** `20x20` tiles (400 initial pre-owned Knowledge tiles + fog revealed per school; permanently protected from rival occupation).

  * **Landmark / Scenic Spot:** `40x40` tiles (10 Vietnam Landmarks placed across the mid/center ring of the map).

  * **UniStop:** `10x2` tiles (configurable to `10x5`).

  * **Chest:** `2x2` tiles.

* **Fog & Visibility (`C-08`):**

  * Publicly visible on map: Terrain, 8 School HQs, 10 Landmarks (with current active Beacon school & threshold), and UniStop positions.

* Public active Knowledge overlay: every registered school sees active Knowledge membership for every subscribed map chunk, including tiles outside its own discovery. Shared tiles show all active member-school colors; this overlay contains no fog, exploration history, actor identity, wallet, timer, or private object data.

* School-private: Own school remembered fog geography (5x5 reveal kernel around explored tiles), own Shared/Contest timers, and own Landmark Crystal pot. Public Knowledge never changes exploration, adjacency, interaction eligibility, or any server-side action validation.

  * Player-private: Personal wallet (Points, Crystals, Keys, Treasure Maps), personal UniStop cooldowns, personal discovered Chest coordinates, and personal Gift entitlements.

## 2. Economy, Exploration & Shared Knowledge (`C-01`, `C-03`, `C-12`)

* **Currencies:** `Points` (for Knowledge exploration/maintenance) and `Crystals` (for Landmark contributions) are separate currencies in the unified player wallet.

* **Exploration (`C-01`):**

  * Exploring a fresh unowned tile orthogonally adjacent (4-edge) to current own-school Knowledge costs **1 Point**.

  * Clicking an already own-school tile or invalid tile is a no-op (`NO_CHANGE`, **0 Points** charged).

  * Diagonal-only contact or opponent-only contact cannot anchor exploration.

* **Shared Knowledge & Coexistence (`C-03`):**

  * Joining an orthogonally adjacent tile currently held by **1 rival school** (outside protected HQ) costs **2 Points** and creates a **Shared Knowledge** tile (max **2 schools** per tile; a 3rd school is rejected).

  * **Upkeep:** First **24 hours** of a connected Shared Knowledge cluster (4-edge connected component for that school pair) are **free**. Afterward, each participating school owes **1 Point per 24h cycle per connected shared cluster** (can be paid by any student of that school).

  * **Lapse & Consolidation:** General decay on solo Knowledge is **OFF**. If Guest B fails upkeep, Incumbent A retains sole Knowledge for **0 Points** immediately. If Incumbent A fails upkeep, Guest B enters a **48h hard consolidation window** (with a **2h rolling timer** reset by each >=1 Point contribution) to contribute `ceil(N / 2)` Points for the `N` inherited tiles; if successful, B becomes sole owner; if expired, tiles become neutral and partial contributions are refunded to original contributors.

* **Leaderboard & Scoring (`C-12`):**

  * Each active Knowledge tile (solo or shared) grants **+1 Knowledge Score** to each active holding school.

  * Tie-breaker: Earliest timestamp reaching the score, then lower `schoolSlot`.

## 3. Landmarks, Puzzles & Beacon Illumination (`C-02`, `C-09`)

* **10 Official Landmarks:**

  * *Danh lam thắng cảnh:* (1) Đỉnh Fansipan, (2) Vịnh Hạ Long, (3) Núi Ngũ Hành Sơn, (4) Động Phong Nha, (5) Núi Bà Đen.

  * *Công trình biểu tượng:* (6) Hoàng thành Thăng Long, (7) Cảng Hải Phòng, (8) Kinh thành Huế, (9) Tòa nhà Bitexco, (10) Chợ nổi Cái Răng.

* **Beacon & Takeover (`C-02`):**

  * A school must have active Knowledge touching the Landmark's perimeter/footprint to interact.

  * Each school accumulates Crystals in its own persistent Landmark pot.

  * **First Illumination Threshold:** **1,000 Crystals** (configurable to `100` in `gameConfig.ts`).

  * **Takeover Threshold:** Linear `+5%` of base per takeover (`1000 -> 1050 -> 1100 -> 1150...`).

  * **Puzzle / Hint Bonus (`C-09`):** Enabled as a configurable module (ported from V1 `landmarkModal.ts` + `landmarkPuzzle.ts`): solving the Landmark puzzle grants `+10%` of the current target (`100 Crystals` on base `1000`) once per school per Landmark; wrong guess triggers a **10-minute cooldown**.

  * **Buffs:** Active Beacon holder receives the Landmark's school buff metadata on the HUD/leaderboard until another school takes over the Beacon.

## 4. UniStop, Chests, Keys, Carousel & Gifts (`C-06`, `C-07`, `C-10`, `C-11`)

* **Tier Naming (`C-07`):** Standardize on **`aspire` / `nitro` / `predator`** across UniStops, Chests, and Keys (accept `silver`/`gold`/`platinum` as UI/legacy display aliases only).

* **UniStop Architecture & School Capture Mechanics (`C-06` — CRITICAL FIX):**

  * **ONLY 3 UNISTOP TYPES EXIST:** `UniStop - Aspire`, `UniStop - Nitro`, and `UniStop - Predator` (plus 3 Chest types: `Chest - Aspire`, `Chest - Nitro`, `Chest - Predator`).

  * **NEVER bind a UniStop or Chest definition to a specific `schoolSlot` (`dev-aspire-0..7` is DEPRECATED/FORBIDDEN).** All UniStops and Chests are **neutral world objects** placed on the map by the Admin via Map Editor (or default world seed, e.g., 15 neutral UniStops: 8 Aspire, 5 Nitro, 2 Predator; and 15 neutral Chests: 8 Aspire, 5 Nitro, 2 Predator).

  * **School-Wide Capture & Shared School Access (`ownerSchoolId`):**

    1. Every UniStop starts **neutral (`ownerSchoolId = null`)** on the map.

    2. When any student of **School A** expands their school's Knowledge to touch/overlap the UniStop's footprint (and no other school currently holds `ownerSchoolId` on it), that UniStop is **captured/marked for School A (`ownerSchoolId = 'hcmut'`, etc.)** and displays School A's color/flag badge on the 3D map and Minimap.

    3. Once captured by School A, **ALL students belonging to School A** can click and spin that UniStop (each student has their own personal per-station cooldown: **Aspire = 12h**, **Nitro = 24h**, **Predator = 24h**).

    4. If School A loses all active Knowledge tiles touching that UniStop (e.g., via Shared Knowledge upkeep lapse/consolidation loss) while rival School B has active Knowledge touching it, `ownerSchoolId` transfers to School B (matching V1 `captureReachedStops` logic).

    5. Remove all pre-granted per-school `reward_discoveries` for `dev-aspire-0..7`. A school's available UniStops in the UI/HUD are dynamically determined by which world UniStop instances currently have `ownerSchoolId === student.schoolId` (or are touched by the school's active Knowledge).

  * **Weekly Running Eligibility (`C-10`, `C-11`):** Students **without** synced weekly running km (`weeklyRunningKm <= 0` for the current `Asia/Ho_Chi_Minh` Mon–Sun week) **CAN still spin UniStop and open Chests for in-game rewards**, but if the server RNG lands on a `Gift` slot (or if `Gift` stock is 0), the roll deterministically falls back to the top-tier Crystal reward of that table (`Crystals x4` for UniStop, `Crystals x10` for Chest) so no spin ever errors out or blocks play.

* **Approved Probability Tables (`C-10` — Exact Weights):**

  * **UniStop (`Aspire / Nitro / Predator`):**

    * `Points x1`: `32.5% / 29.5% / 25.0%`

    * `Points x2`: `10.0% / 11.0% / 12.5%`

    * `Points x3`: `5.0% / 7.0% / 10.0%`

    * `Crystals x1`: `32.5% / 29.5% / 25.0%`

    * `Crystals x2`: `10.0% / 11.0% / 12.5%`

    * `Crystals x4`: `5.0% / 7.0% / 10.0%`

    * `Treasure Map`: `3.0% / 3.0% / 3.0%`

    * `Key (matching tier)`: `2.0% / 1.9% / 1.5%`

    * `Gift`: `0.0% / 0.1% / 0.5%`

  * **Chest (`Aspire / Nitro / Predator`):**

    * `Points x1`: `30.0% / 25.0% / 20.0%`

    * `Points x2`: `13.5% / 15.0% / 16.5%`

    * `Points x5`: `5.0% / 7.5% / 10.0%`

    * `Crystals x1`: `30.0% / 25.0% / 20.0%`

    * `Crystals x5`: `13.5% / 15.0% / 16.5%`

    * `Crystals x10`: `5.0% / 7.5% / 10.0%`

    * `Gift`: `3.0% / 5.0% / 7.0%`

* **Treasure Map, Chests & CS:GO Carousel (`C-07`):**

  * Receiving a `Treasure Map` reveals the coordinates/navigation pointer to an uncollected world Chest for that player.

  * Opening a Chest atomically consumes **1 matching Key**, marks the finite world Chest instance as collected (single winner under race conditions), and displays the server-determined outcome using the **CS:GO Carousel Modal** (ported from V1 `carouselModal.ts`).

* **Running Conversion Default (`C-11`):**

  * Use configurable `kmToPointsRate = 10` (`1 km = 10 Points`) in `gameConfig.ts` for the local/staging `CampaignProvider` and promote synced running Points directly into the active playable wallet so the full loop works end-to-end.

## 5. Admin Editor, Notifications & Leaderboard (`C-13`)

* Port V1's `statsOverlay.ts`, `miniMap.ts`, `notificationBanner.ts`, and `mapEditorPanel.ts` into V2 and connect them to authenticated server endpoints (`ADMIN_KEY` / role check for publishing map layout updates, placing Chests/UniStops/Landmarks, and triggering campaign notifications).

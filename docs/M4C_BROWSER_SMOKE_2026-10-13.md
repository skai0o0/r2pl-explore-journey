# M4-C browser smoke evidence — 2026-10-13

Status: partial browser evidence added; final M4-C visual/GPU acceptance remains OPEN.

Windows, Edge extension browser, local loopback build from codex/m4a-playable. PostgreSQL 16 disposable database; Dawn/Dusk only. No production accounts or data. Desktop CSS viewport was 1055×991. Responsive override requested 390×844; observed CSS viewport was 433×937 (browser scaling), so this is narrow-layout evidence, not an exact 390px device claim.

| Check | Observed evidence | Result |
|---|---|---|
| Durable exploration | Dawn Explorer 2 explored (250,226), balance 30→29, committed indicator and own-school presence | PASS |
| Isometric / top-down | Keyboard I updated accessible world description and camera status; both views rendered | PASS |
| HQ / Landmark models | Both visible at their navigation anchors; zoom made HQ fixture geometry visible | PASS for fixtures, no artwork signoff |
| Zoom / navigation | Zoom buttons and HQ/Landmark navigation changed the view | PASS |
| Two-session delivery | Explorer 1 subscribed before Explorer 2 explored (249,237); new green tile appeared in Explorer 1 view before clicking it | PASS |
| No-change cost | Explorer 1 clicked (249,237), received already explored / no credit spent, balance remained 30 | PASS |
| Reload | Explorer 2 reloaded and retained balance 28 and discovered tiles | PASS |
| Narrow HUD | 433px CSS width, document scrollWidth=clientWidth=433; controls and selection panel visible | PASS for observed layout |
| Narrow pointer exploration | Explorer 1 clicked (254,246), committed and balance 30→29 | PASS for pointer, not physical touch |
| School switching | Selector moved Explorer 1 to Dusk; selection cleared and Dusk connection entered | PASS for switch; rival-mask isolation additionally covered by automated tests |
| Browser error inspection | One asynchronous message-listener error was observed; its origin was not established | INVESTIGATE if reproduced; no blanket console-clean claim |
| Physical touch/pinch | Not exercised by this browser API | PENDING |
| Insufficient-credit manual flow / asset-failure browser flow | Automated coverage retained; not run manually in this smoke | PENDING browser acceptance |
| GPU / frame time / long-pan memory | Not measured; no device GPU metrics captured | PENDING |

Desktop artifact: [committed exploration screenshot](screenshots/m4c-desktop-2026-10-13.jpg).

Several Page.captureScreenshot calls timed out on the secondary tab. Native activation allowed visual inspection, but a later mobile capture contained tiled/composited artifacts. That generated image was discarded; no reliable mobile screenshot artifact is claimed. Temporary viewport overrides were reset.

This smoke does not prove 1000-browser capacity, full desktop/mobile acceptance, or production gameplay. Manual drag/pinch, edge picking, real-device accessibility, fallback and GPU checks remain in the M4-C gate.

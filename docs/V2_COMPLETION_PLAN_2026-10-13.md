# Kế hoạch hoàn thiện V2 — tối thiểu ngang V1

Ngày: 2026-10-13. Trạng thái: kế hoạch triển khai đề xuất theo yêu cầu owner; chưa phải ký duyệt luật hoặc phát hành production.
Baseline khi lập kế hoạch: aaccf70, branch codex/m4a-playable. Current code checkpoint: bf67b66; xem [progress audit2026-10-14](PROGRESS_AUDIT_2026-10-14.md) và [current status](COMPLETION_PROGRESS.md). Baseline V1 read-only: 79e5cfa2a16101fd3872eacb52ef6d2fafcc03d4.

## 1. Đích đến và cách nghiệm thu

Có hai đích đến bắt buộc, không kết thúc ở demo khám phá hoặc bot dashboard:

- **G-V1 — bản chơi hoàn chỉnh đạt ngang V1:** người chơi thao tác được toàn bộ vòng chơi tương đương V1 trong UI Three.js của V2; 8 trường cùng chơi; ví/inventory, Landmark, UniStop, Chest, leaderboard, thông báo và editor có luồng hoàn chỉnh. Thay cơ chế cũ bằng hướng Gamenote đã thống nhất. Local/staging dùng provider và stock synthetic có nhãn rõ khi bên ngoài chưa sẵn sàng. Mọi hành động quan trọng bền vững qua restart và retry. Không tuyên bố tích hợp thật từ mock.
- **G-FULL — bản hoàn chỉnh theo Master Plan/Gamenote, vận hành chiến dịch thật:** G-V1 cộng identity/running thật, luật/config/map được duyệt, Gift stock/entitlement/check-in thật, LiveOps, phân quyền/audit, visual/device QA, capacity và backup/restore/deploy/rollback đạt gate.

V1 là chuẩn mức độ chức năng và trải nghiệm, không là nguồn luật production hoặc chuẩn durability. Không sao chép lệ phí 3 Points, decay 22h, quy đổi mock 1km=10 Points, chuyển Points→Crystal 1:1, raw rival-mask broadcast hay room monolith. Với hành vi bị thay thế bởi Gamenote, nghiệm thu luồng V2 thay thế cùng nhu cầu của người chơi, ghi rõ lý do chênh lệch.

Mỗi feature chỉ tính DONE khi có đủ: contract/rule version rõ, pure rules nếu cần, transaction server, projection đúng quyền, UI thật, test network/PostgreSQL, browser playtest và báo cáo review. CLI/demo, pure candidate hay endpoint chưa có consumer UI chỉ là PARTIAL. Owner review sau mỗi build playable; production activation là bước riêng sau G-FULL.

## Core gameplay prerequisite — owner correction 2026-10-14

R2-00 is mandatory before higher-level gameplay acceptance: durable free initial HQ Knowledge/fog; server-enforced four-edge expansion from own-school Knowledge; no diagonal/opponent anchor; same-school simultaneous boundary commands, cross-chunk growth, no-charge rejection/retry and restart. A bot planner obeying adjacency is not proof of server enforcement. This omission in the original plan is corrected by [HQ/frontier integration](HQ_FRONTIER_INTEGRATION_2026-10-14.md). Require this journey in future gameplay regressions; do not count historical arbitrary-target fixture benchmarks as playable acceptance.

## 2. Nguồn và trạng thái thực tế

Nguồn kế hoạch: [Master Implementation Plan](../writing-block.md), [ROADMAP](ROADMAP.md), [Gamenote cuối](../R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt), [GAME_SPEC](GAME_SPEC.md), [DECISIONS](DECISIONS.md), [conflicts](SPEC_CONFLICTS.md), [V1 reuse audit](V1_REUSE_MATRIX.md). Đối chiếu bổ sung V1 README, docs/architecture.md, CampusRoom handlers và các module UI/test; đây là source audit, chưa phải chạy lại V1 để chứng nhận browser parity.

Bảng sau là snapshot khi lập kế hoạch ngày13/10 (102 tests), được giữ để truy xuất. Không dùng nó thay cho current status ngày14/10.

| Lớp | Bằng chứng tại snapshot13/10 | Phần chưa được tính hoàn chỉnh tại snapshot |
| --- | --- | --- |
| World/realtime/durability | M1–M3.5 nền tảng đã có nghiệm thu theo scope; 1 triệu ô, school-filtered v1, PostgreSQL/idempotency/outbox | Auth/economy/command sản phẩm và capacity production chưa đạt |
| Client playable | M4-A accepted; M4-B/C có foundation và isometric/assets/input; desktop+narrow smoke | Các modal/vòng gameplay đầy đủ; physical touch, GPU/memory, UX acceptance |
| Knowledge lifecycle | Pure legacy candidates/test tồn tại | Shared/contest/upkeep/claim/refund chưa nối authoritative runtime; không kích hoạt candidate cũ |
| Running | Provider contracts + synthetic correction-aware reconciliation | Real provider, verified account binding, signed conversion và live wallet chung |
| Rewards | Aspire UniStop và fixed Chest transaction ở r2pl_prep, crypto RNG, Key/ledger/retry/crash tests | Chưa nối gameplay world, live relay hoặc UI; Gift-bearing profiles fail closed |
| Bots | 8 aliases/24 WS clients; mixed/fast/bursty/slow; all 28 school pairs trong gather | Chỉ explore/overlap, chưa chạy full gameplay; observer SVG riêng không phải UI người chơi |
| Regression | Lượt full PostgreSQL mới nhất 102/102 pass, strict/lint/build pass | Đây là foundation evidence, không chứng minh các feature chưa triển khai |
| Delivery | M3.6 hotspot chưa đạt; bot reconnect bộc lộ ~30s lease recovery | Phải sửa và đo lại; đợi 45s để hội tụ không được coi là sửa latency |

[Running preparation](INTEGRATION_PREPARATION_REPORT_2026-10-13.md), [reward preparation](REWARD_PREPARATION_REPORT_2026-10-13.md), [browser evidence](M4C_BROWSER_SMOKE_2026-10-13.md), [bot evidence](BOT_SIMULATION_REPORT_2026-10-13.md), [performance targets](PERFORMANCE_TARGETS.md).

## 3. Ma trận tối thiểu ngang V1

Mỗi hàng là điều kiện độc lập của G-V1, không lấy điểm mạnh backend bù cho feature thiếu trên UI. Dấu FULL chỉ dùng sau test/browser và review, không chỉ vì thấy source handler.

| ID | Có trong V1 / nhu cầu người chơi | V2 hiện tại | Kết quả bắt buộc của V2 | Gói |
| --- | --- | --- | --- | --- |
| PV01 | Student profile, school selection, wallet/HUD | 8 synthetic schools, credit HUD + inventory4 resources | 8 trường fixture trong UI, Points/Crystals/Keys tách biệt, loading/error/receipt/balance khớp server; real identity sau đó | R1/R3/R8 |
| PV02 | World 1000×1000, HQ, fog, camera/minimap, picking | HQ20×20 seed,4-edge authority,8 placed placeholder models | 8 HQ staging, object placement hợp lệ, overview/detail, navigation/minimap, input desktop/mobile | R3 |
| PV03 | Explore và study/review | Server-enforced HQ/frontier/no-change/retry; review chưa live | HQ-owned seed + four-edge frontier enforced server-side; Explore và ôn/review đúng spec được chốt; retry/no-change không mất tiền ngoài luật; UI giải thích giá và effect | R2 |
| PV04 | School coexistence/giao lưu và pha màu | Bot overlap; legacy pure contest | Quan hệ shared/contest được duyệt, lệnh tham gia/duy trì/đóng góp, UI trạng thái/deadline/lý do từ chối; giới hạn số trường theo rule | R2/R3 |
| PV05 | Retention/housekeeping | Không có lifecycle live | Upkeep/forgetting/claim thay thế decay V1 theo rule mới; durable deadlines, exact refunds và recovery | R2 |
| PV06 | Profile resources và conversion UI | Common dev explore/reward wallet + panel; running prep riêng | Một authoritative account model, inventory và lịch sử receipt; conversion chỉ khi có luật riêng, không lén chọn 1:1 | R1/R4 |
| PV07 | Landmark puzzle/hint/guess/cooldown | Pure candidate + placeholder art | Landmark modal, answer server-side, cooldown, hint/reveal và đóng góp hiển thị realtime | R5 |
| PV08 | Landmark contribution/beacon/takeover | Chưa có transaction live | Crystal ledger/pots, concurrent threshold/takeover đúng config, trường beacon, buff lifecycle đã duyệt | R5 |
| PV09 | UniStop 3 tiers, cooldown/reward modal | Aspire dev transaction + panel; Nitro/Predator policy pending | Cả 3 tier trong UI, access/eligibility rõ, timer không tích lũy lượt, persisted roll và inventory update | R4 |
| PV10 | Treasure Map dẫn tới Chest | Reference inventory chưa có journey UI | Treasure Map receipt, clue/discovery theo quyền, đường tới Chest; không lộ rương bí mật của người khác | R3/R4 |
| PV11 | Keys, Chest finite/exclusive, carousel | Fixed Chest/common Key wallet + panel; starter discovery | Tier mapping chốt, Key atomic spend, một winner theo consumption policy, carousel trình bày đúng kết quả server, reconnect không reroll | R4 |
| PV12 | Gift result/profile display | Không có live Gift workflow | Local entitlement/stock synthetic có nhãn; Gift-bearing draw dùng chính policy được duyệt; real stock/check-in ở R8 | R4/R8 |
| PV13 | School ranking, stats overlay, first-goal guidance | Bot counters; chưa product leaderboard | School/player leaderboard theo metric được duyệt, ties/corrections, first-action→first-object journey và stat detail | R3/R6 |
| PV14 | Game events, notification banner/toast | Chưa product event loop | Typed committed events; toast/inbox, reconnect dedup, trigger đúng quyền; event scheduler/config tối thiểu | R6 |
| PV15 | Map Editor/dev tools/notification studio | Chưa editor product | Draft/save/load/validate/place/publish/rollback; roles và audit; preview notification/event; không cần sửa code cho thao tác thường | R6 |
| PV16 | Profile/cooldown reconnect | Explore/reward durable; reward recovery theo campaign+actor; running riêng | Snapshot/resync cho tất cả state, ACK loss và server restart không mất/chồng tiền, cooldown, claim, score | R1–R7 |
| PV17 | Dev provider và campaign reference | Contract/prep có | Local provider dùng cùng service với real adapter, hiển thị mock status; normal user không được cấp dev/admin qua URL | R1/R8 |
| PV18 | HQ model/scene feel, normal/dev modes | 8 HQ fixture glTF đúng placement/isometric; inventory dialog | Branding, models hoặc fallback hợp lệ, cùng mức readable/polished V1, admin/dev tools không lẫn UI normal | R3/R7 |

PV03/PV05/PV06/PV08/PV09 có chênh lệch luật với V1 hoặc giữa các note. Chốt behavior replacement trước khi đánh DONE; không yêu cầu giữ luật cũ để đạt parity. V1 external running, approved buff pool và notifications push vốn có placeholder; parity local có thể dùng adapter synthetic, nhưng G-FULL không được bỏ các phần production đã chọn trong scope.

## 4. Chuỗi triển khai và mốc review

Critical path cho G-V1: **R0 → R1 → R2 + R3 → R4 + R5 → R6 → R7**. R9 delivery investigation bắt đầu song song ngay; phần capacity cuối chỉ sau full gameplay. R8 contract preparation chạy song song, adapter thật chỉ triển khai khi nhận contract và có authorization tương ứng.

### R0 — hợp nhất spec và checklist parity (M4-D0)

- R0-01: chuyển từng PV01–PV18 thành checklist có scenario, đường UI, backend/test evidence và trạng thái.
- R0-02: tạo một current implementation spec duy nhất, bảng source→approved/superseded/pending; khớp GAME_SPEC/DECISIONS/SPEC_CONFLICTS/decision pack, giữ nguyên owner Gamenote.
- R0-03: xử lý cụ thể bốn nhóm đang mâu thuẫn: (a) phí/shared/upkeep/claim clocks và scoring; (b) Landmark 100/120 hay 1000/+5%, buff/carry-over; (c) footprint HQ20 hay30, UniStop10×5 hay10×2, Landmark dimensions; (d) người không có running được dùng UniStop nhận ingame loot hay bị khóa toàn bộ. Latest Gamenote là hướng sản phẩm; historical Round4 không tự lấn át, production vẫn cần version đã duyệt.
- R0-04: chia release policy dev/staging/production; approved examples cho ruleVersion; map/content/catalog version tách riêng; bất kỳ numeric candidate chưa được chọn giữ inactive.
- R0-05: chốt command/projection boundary mới. Protocol v1 vẫn unchanged ở baseline; extension cần compatibility/ADR/owner review trước khi áp dụng, không ép lệnh mới vào v0 explore.
- **Exit:** current spec + decision worksheet ngắn, không còn câu chỉ dẫn đối nghịch cho một behavior; owner review theo feature, không cần đóng mọi C-ID mới được chuẩn bị phần độc lập.

### R1 — account và authoritative feature integration (M3 mở rộng + M4)

- R1-01: account identity/school binding cho staging synthetic 8 trường; auth adapter rõ boundary với provider thật; dev identity không chảy vào production.
- R1-02: Points/Crystals/inventory cùng ledger/reconciliation contract; quyết định promotion/rebuild các preparation services, không import thẳng fixture-credit vào production economy hoặc ghép ba ví bằng hệ số tự chọn.
- R1-03: persisted command receipt, schema migration plan/forward/rollback, feature flag và rule snapshot cho domain services. Không migration dữ liệu V1.
- R1-04: relay private actor inventory/receipt/cooldown, own/party/public object views; authorization được revalidate khi reconnect/chuyển trường.
- R1-05: typed command adapters bên Gateway Room; contract snapshot/resync/profile/HUD; server vẫn commit trước ACK.
- **Exit:** một action staging từ browser đổi ví/inventory, có durable receipt, own client cập nhật, reload/restart/retry vẫn đúng; wallet isolation, payload conflict, concurrency/rollback/crash tests pass.

### R2 — Knowledge/shared lifecycle hoàn chỉnh (M4-D1/D2)

- R2-01: pure versioned reducer thay legacy candidate, topology/components pair-specific theo spec được chọn; study/review semantics.
- R2-02: atomic explore/join/upkeep/departure/contribution, school component revisions, actor debit/receipt và score events.
- R2-03: persisted timers/scheduler, frozen eligible sets/incumbent nếu thuộc approved rule; escrow/refund obligations và bounded worker. Replay từ DB time, không dùng thời gian browser, không quét triệu tile mỗi tick.
- R2-04: private own/party status/deadline/contribution projection, safe public aggregate; shared art không cần raw rival mask.
- R2-05: UI đang chờ/applied/rejected/no-change, cost, progress, deadline, payment/refund history; bot adapters thêm các command thực sự có, capability report không còn hardcode giả.
- **Exit:** hai browser khác trường và ít nhất hai actor cùng trường hoàn thành cycle vào chung→duy trì→rời→claim/refund theo spec, giữ qua crash. Clock boundary, third school, merge/split, same last Point và same key race đều có test. K01–K24 chỉ áp dụng các case còn đúng spec R0, không auto kế thừa candidate mâu thuẫn.

### R3 — world và UI chơi 8 trường (M4-C + World Design)

- R3-01: versioned object registry, staging map 8 HQ + 10 Landmark + 3 UniStop tiers + Chest; footprint/collision/protection/reachability validator. Production coordinates/content chưa chốt thì dùng staging layout có nhãn, không publish thật.
- R3-02: bổ sung object interaction vào Three.js client: tooltip, selection/action dock, navigation/minimap, panel profile/inventory; normal/dev/admin routes rõ.
- R3-03: đưa bots vào cùng playable campaign/session, cho observer authorized xem trên renderer game và cho student view thấy đúng own school. Dashboard SVG hiện tại giữ làm measurement aid.
- R3-04: onboarding ngắn: điểm xuất phát→explore đầu→mục tiêu Landmark/trạm/rương; tìm đường, thiếu Points/Key, cooldown và unavailable được giải thích trong UI.
- R3-05: overview/detail allocation, asset fallback/lazy load, pan/zoom/picking/physical touch, accessibility contrast và Vietnamese content.
- **Exit:** 8 trường chơi cùng build Three.js; bot và người dùng cùng thấy committed world effects đúng quyền; desktop/mobile walkthrough và screenshot review. 8 HQ không bị overlap, có đường hợp lệ tới object trong staging map; production World Design signoff vẫn riêng.

### R4 — rewards, UniStop, Treasure Map, Chest và inventory (M6 batch có review)

- R4-01: promote Aspire/fixed Chest prep qua world access/discovery, authoritative account và private relay; chạy từ modal thật.
- R4-02: chốt Key/Chest catalog/tier, Treasure Map discovery, finite/exclusive claim; inventory transaction và receipt history.
- R4-03: Nitro/Predator + Chest gacha theo exact versioned table; server crypto RNG, outcome/roll persist; không normalize, redraw/fallback chưa duyệt thì fail closed trước RNG.
- R4-04: bounded synthetic Gift stock, eligibility fact, reservation/entitlement/stock exhaustion transaction để local E2E có đầy đủ luồng. Production stock/claim/check-in đợi R8; không phát quà thật.
- R4-05: countdown, reward modal, carousel/skip/reduced motion, durable result nhận lại sau reload, Key/Points update sau commit; animation không quyết định outcome.
- **Exit:** 3 UniStop tiers và các Chest tiers từ UI; concurrent cooldown, 20 opens/1 Chest, insufficient Key, rollback/overflow/crash, fixed outcome replay, stock cuối và entitlement idempotency pass; actor-private discoveries không leak.

### R5 — Landmark puzzle, contribution, Beacon và buffs (M4-D3 + M6)

- R5-01: content pack 10 địa danh, ID/hint/story/answer normalization, hidden answer server-side, asset/fallback.
- R5-02: puzzle guessing/rate limit/cooldown/correct answer receipt, shared school puzzle-reward policy được duyệt.
- R5-03: Crystal contribution/ledger, school pots, threshold/takeover/carry-over/reset rõ; serialize last contribution và buff revoke/activate bằng committed events.
- R5-04: buff catalog/version, balance limits, scoring/economy effects nếu có; cấu hình thiếu không tự grant default buff.
- R5-05: UI hint/progress/school beacon/history, next goal và school notification.
- **Exit:** một Landmark E2E trước rồi đủ 10; hai trường race takeover, replay puzzle/contribution và restart không reward trùng; sai đáp án cooldown; buff bật/tắt đúng khi đổi trạng thái. Owner review art, content và gameplay feel.

### R6 — leaderboards, editor, notifications và LiveOps (M6)

- R6-01: school/player metrics, active/ever-known/shared/claiming/ties/correction theo rule; rebuildable score projection khớp durable domain source, không double-count replay.
- R6-02: typed event log/outbox→in-game toast/inbox; reconnect cursor/dedup, school/actor privacy; schedule milestone, cap và notification preview.
- R6-03: admin auth/RBAC, draft object editor, validation, export/import, publish immutable layout version, diff/audit/rollback; runtime object edits không revive consumed Chest hoặc xóa legitimate Knowledge.
- R6-04: school onboarding late join trong 16 slots, protected spawn theo approved policy; không chọn mở rộng world size hay X ngày tự động. Event/catalog/content operations không cần sửa source.
- R6-05: operational dashboard cho outbox lag, actor reconciliation, stock, admin audit; browser push chỉ sau consent/provider quyết định, in-game notification luôn có.
- **Exit:** admin vận hành một staging campaign/event/layout change qua UI, rollback hợp lệ, unauthorized student bị từ chối server-side; score khớp sau replay/recovery và owner workflow review.

### R7 — G-V1 acceptance: full playable build và polish

- R7-01: lấy checklist PV01–PV18, từng hàng có video/screenshot/receipt/test evidence; bất kỳ thiếu feature nào chưa thông qua sẽ chặn nhãn ngang V1.
- R7-02: multi-browser 8-school journey: nguồn Points synthetic→explore→shared→Landmark→UniStop→Treasure Map/Key→Chest→reward/inventory→ranking/notification→logout/rejoin. Admin editor/event journey riêng.
- R7-03: full-feature bot mix explorer/connector/maintainer/puzzle/contributor/collector; same-tile/component/station/Chest hotspots, insufficient funds, reconnect/ACK loss và restart. Bot chọn từ authorized state, không khai thác admin map.
- R7-04: soak đề xuất 2h local và 24h staging với clock-accelerated boundary fixtures; memory/outbox drain/backlog/ledger/inventory/score metrics. Đây là correctness/soak, không thay capacity target.
- R7-05: 5–8 người playtest mới (đề xuất), ≥2 browser desktop và ít nhất Android/iOS mục tiêu đã thống nhất; thao tác đầu/mục tiêu tiếp theo dễ hiểu, không cần mở dev console, không crash/block core loop. Desktop 60fps/mobile30fps target theo PERFORMANCE_TARGETS, phải đo trên device được chốt.
- **Exit G-V1:** tất cả PV đạt, no outstanding P0/P1 về core loop, strict/lint/build/full DB + browser E2E pass; owner ký review playable parity. C-11 external mock, Gift synthetic, World Design pending và capacity chưa đạt phải ghi rõ, nên nhãn là complete local/staging build, chưa production.

### R8 — identity/running và Gift fulfillment thật (M5 + M6 integration)

- R8-01: gửi ra decision/contract package để owner/đội webdev xử lý: session verifier, stable actor/school IDs, meter units, revision/correction, rate limits/auth/error, freshness/timezone/week, backfill/conversion/debt policy. Không tự gửi thông tin cho bên ngoài; chuẩn bị artifact cho owner chuyển.
- R8-02: khi contract/authorization có, real CampaignProvider adapter + session verification, security/privacy, replay/backfill/corrections vào cùng authoritative wallet R1; ingame rewards tách running source và spendable balance.
- R8-03: eligibility fact, Gift stock ownership/catalog, reserve→entitle→claim/check-in/reconcile workflow, duplicate event/outage/exhaustion/operator resolution; partner API không có thì giữ adapter inactive.
- R8-04: reviewed production migrations, seed roster/layout đã ký, staging sandbox end-to-end, dry-run/reconcile và rollout flag. Mock provider không deploy thành production fallback.
- **Exit:** verified student thật trong sandbox, repeated/corrected feeds không double-credit; Gift claim/check-in retry/recovery đúng và PII không leak. R8 không hoàn thành khi chỉ fixture test pass. Không bắt đầu M5 thật cho tới khi owner cho phép và contract được cung cấp.

### R9 — delivery, scale, recovery và launch (M3.6 + M7)

- **R9-A bắt đầu sớm:** reproduce ~30s outbox recovery với reconnect, xác định failure point và xử lý batch claim/release/order/fanout mà không bỏ event; regression lỗi trước/sau fix. Không gọi tăng wait từ20→45s là performance fix.
- **R9-B sau mỗi major feature:** đo representative workload, sector queue/DB lock/fanout/bytes/outbox lag/CPU/heap/RSS/event-loop, school/actor privacy. Đánh giá coalescing/index/scheduling/batching; v2 experiment không tự được bật.
- **R9-C trước release:** generators/server tách process rồi tách host; 100→1000→5000→10000 connections, mục tiêu 1000 actions/s sustained và burst3–5x; balanced và ≥70% load một sector, thêm same chunk/tile/object races. Tăng stage chỉ khi stage trước đạt và generator không bão hòa.
- Target theo Master Plan: committed ACK p95 <300ms, authorized visible convergence p95 <500ms trong environment đã chốt, queue về baseline trong bound đã duyệt, zero duplicate effects/lost ACKed data/privacy violations. Báo thêm p99/max để không giấu tail30s.
- Chỉ thêm multi-process/Redis/sector distribution nếu benchmark cần và có ADR/review; single writer leasing/fencing phải có trước failover, stale writer không commit được.
- Backup/restore drill, worker/process/DB outage và migration rollback, graceful drain, alerts/runbooks, gift disable switch, campaign pause, release/rollback rehearsal.
- **Exit G-FULL:** G-V1 + R8 + approved world/rules/content/admin + device/GPU + R9 đạt; release checklist có capacity thực đo, signer và rollback. Capacity nhỏ hơn10k chỉ được ghi là limited pilot với cap cụ thể và owner-approved revised gate, không gọi đạt Master Plan hoặc full launch.

## 5. Decision/blocker package: tiếp tục được gì khi thiếu đầu vào

| Dependency | C-ID / chủ đầu vào | Chuẩn bị ngay | Chưa được đánh DONE |
| --- | --- | --- | --- |
| Knowledge + scoring chính xác | C01/C03/C08/C12, owner | Case matrix, reducer/contracts/schema draft, fixture clock, shared renderer mock có nhãn | Approved gameplay runtime/prod rule khi các case còn mâu thuẫn |
| Roster/layout/geometry | C04/C05, owner + content/design | Validator/editor draft/staging layout, 16-slot onboarding tests | Production HQ IDs/coordinates/world publish |
| Landmark/content/buffs | C02/C09, owner + content | Registry, puzzle/cooldown/contribution contracts và art fallback | Final numeric thresholds/buff economy; 10 assets/content QA |
| Reward access/tier/eligibility/stock | C06/C07/C10, owner + campaign ops | Extend existing prep service, synthetic stock/entitlement, UI pending/disabled/error | Gift-bearing rollout nếu fallback/exhaustion/tier chưa chọn |
| Identity/running API | C11, external team + owner | Existing provider/reconciliation, contract tests, mock E2E, config without defaults | Real identity/crediting/weekly eligibility, production endpoints |
| Admin/event/push ops | C13, owner + operator | Role contracts, versioned drafts, audit/in-game notification | Production roles/provider/push consent/stock check-in |
| External agent CLIs | Owner-controlled tool setup | Codex contracts/backend/review; documented frontend tasks và isolated branches | Antigravity/MiMo contribution khi CLI chưa chạy; không thay model âm thầm |

Không để toàn repo đứng chờ một C-ID: xử lý các tasks độc lập và contracts/tests/fixtures trước. Task phụ thuộc quyết định không được tự chọn production default. Một external dependency không chặn G-V1 local nếu V1 cũng dùng mock; nó vẫn chặn G-FULL thật.

## 6. Phân công và cách làm

Theo AGENTS: Codex chịu architecture/minimal shared contracts/Colyseus/PostgreSQL/review/integration/final verification; Antigravity frontend trong worktree riêng; MiMo pure gameplay/test trong worktree riêng. Dùng đúng model owner đã yêu cầu, high effort; mỗi người chỉ edit/commit assigned files, không V1/integration branch/credentials/another worktree. Codex review diff và tests trước integration. Backend projection/security giữ Codex, không chuyển cho frontend chỉ vì có chữ projection trong backlog cũ.

Hiện CLI external không khả dụng trong các increment vừa qua. Kế hoạch không giả định đủ 3 agent chạy và không hứa lịch song song trước khi xác minh tools/model/worktree. Khôi phục CLI hoặc owner thay đổi phân công trước khi giao phần tương ứng; meanwhile Codex tiếp tục phần backend/contracts/verification được giao. Không cần spawn agent cho việc lập kế hoạch này.

Mỗi build là một vertical slice có UI + real command + persisted state; không dồn tất cả frontend sau backend. Sử dụng ADR/contracts nhỏ, test receipt/conservation/privacy tại boundary, giữ main Room transport-only, feature flag OFF tới stage review. Không đổi engine/ORM/broker hay giữ parallel authoritative legacy state để làm nhanh.

## 7. Thứ tự ưu tiên và dự toán

**Bắt đầu kế tiếp:** R0 source reconciliation/acceptance list và R9-A replay/reconnect incident; sau đó R1 unified account/command/private receipt và R3 playable fixture roster. Deliverable review đầu tiên: 8-school Three.js game với wallet/profile thật trong staging account, cùng bot→player-view delivery, một object action có receipt. Sau review mới mở rộng R2/R4/R5 theo gates riêng.

Dự toán sơ bộ theo khối lượng còn thiếu (không phải cam kết ngày giao, không dựa benchmark V1):

| Batch | Số vòng review đề xuất | Công sức sơ bộ |
| --- | ---: | --- |
| R0 + R9-A + R1/R3 integration slice | 2–3 | 6–10 ngày làm việc kỹ thuật |
| R2 Knowledge + R4 rewards + R5 Landmark | 4–6 | 15–25 ngày |
| R6 admin/ranking/liveops + R7 parity/UX | 3–4 | 10–15 ngày |
| R8 real integration + R9 scale/ops | 3–5 | 10–20 ngày sau khi đủ contract/environment |

Tổng khoảng 31–50 developer-days tới G-V1; thêm10–20 developer-days cho integration/hardening trong trường hợp không phải tái kiến trúc scale. Đây là engineering estimate, chưa gồm owner decision latency, external API/content, thiết bị/hạ tầng load test, external CLI setup hoặc phát hiện bottleneck buộc đổi architecture. Chỉ lập lịch calendar sau R0 review và xác minh nhân lực/tools. Không rút review/QA để ép lịch; multi-agent giúp tasks độc lập, không triệt tiêu critical path.

## 8. Release checklist có thể kiểm chứng

- [ ] Tất cả PV01–PV18 có DONE evidence và behavior differences đã được ghi/chốt.
- [ ] Các command/reward/claim/timer từ UI có real durable transaction và private committed event; không còn ba hệ fixture wallet rời rạc để demo giả full loop.
- [ ] Kịch bản 8 trường + 2 actor/trường + viewer roles + hostile input chạy; bot dùng cùng authorized command path, 0 hidden-data leaks.
- [ ] Pending/rejected/no-change/insufficient funds/expired/duplicate/reconnect/loading/fallback flows có UI; carousel không reroll; deadlines không trust client clock.
- [ ] Full PostgreSQL regression và browser E2E/crash/restart/ledger/refund/stock/score reconciliation pass; số test tăng không thay bằng chứng UX.
- [ ] Real-device pan/pinch/picking/accessibility, asset budget, frame time/heap/RSS và representative rendering pass.
- [ ] Rules/catalog/layout/school mapping có versions/signoff, production permission flags explicit; không bật pending historical candidates.
- [ ] Identity/running/Gift external contracts sandbox pass; corrections/backfill/outages/audit/PII/weekly boundary tested.
- [ ] Editor/admin roles/audit/draft/publish/rollback, events, notifications và check-in hoàn tất trên operator UI.
- [ ] Capacity theo Master Plan được đo, không dùng 24 bots hoặc V1 microbenchmark làm chứng cứ10k; lease30s và hotspot tail đã xử lý/nghiệm thu.
- [ ] Backup restore, deployment/rollback/drain/alerts/runbooks và campaign/reward disable đã diễn tập.
- [ ] Owner acceptance G-V1 rồi G-FULL và quyết định release được lưu riêng.

Không thuộc phạm vi tự thêm: wagering/đặt cược, map tăng ngoài1000×1000, mới engine/broker, real student fixtures, production credentials, re-enable conquest legacy. Late onboarding/push/buffs theo các policy đã chọn; tính năng chưa được chọn ghi rõ pending, không lược bỏ mà vẫn gọi full.

## 9. Hồ sơ từng lần giao

Mỗi lần cập nhật: task IDs, commit/branch, actual model/worktree/contribution nếu có external agent; migrations/protocol/rule diff; strict/lint/build/relevant tests; PostgreSQL/network/browser evidence; performance workload/environment nếu liên quan; updated PV status; limitations/gates và mục review tiếp theo. ROADMAP dẫn tới kế hoạch này; trạng thái gate lịch sử không tự đổi thành accepted bởi tài liệu kế hoạch.

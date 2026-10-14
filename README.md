# R2PL Game V2 — Hành trình Khám phá (Explore Journey)

> **Trạng thái:** Ký duyệt chính thức **`ruleVersion = 1`** ([`docs/GAME_SPEC.md`](docs/GAME_SPEC.md)). Đạt chuẩn **G-V1 Parity** với 18/18 hành trình người chơi & vận hành (PV01–PV18 FULL).

Dự án game khám phá bản đồ 1.000 × 1.000 ô cho giải chạy **Road to Predator League 2027**, phục vụ sinh viên 8 trường đại học lớn tại Việt Nam: **HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU**.

---

## 1. Hướng dẫn Chạy Dev Server & Trải nghiệm

Dự án cung cấp 2 chế độ chạy tùy theo mục đích phát triển:

### Chế độ A: Dev Server (Hot-reload UI, Shader & Đồ họa 3D không cần PostgreSQL)
Dùng khi cần phát triển, tinh chỉnh giao diện, camera Three.js, shader viền ô, ánh sáng, hiệu ứng đổi màu tile và Colyseus WebSocket in-memory cực nhanh:

1. **Khởi chạy Backend dev server (Colyseus WebSocket 2568 + HTTP API 4176):**
   ```bash
   npm run dev:server
   ```
2. **Khởi chạy Vite Frontend dev server (cổng 5173, tự động proxy `/api` sang 4176):**
   ```bash
   npm run dev
   ```

* 🌐 **Truy cập:** [**`http://localhost:5173/`**](http://localhost:5173/)
* ⚡ **Tính năng:** Đầy đủ 8 trường đại học, 16 tài khoản test sinh viên, 10 Landmark, 15 UniStop, 15 Rương, Colyseus WebSocket thời gian thực mà không cần cài đặt hoặc kết nối PostgreSQL.

---

### Chế độ B: Full-stack Playable Server (G-V1 Đầy đủ với 8 Trường + Bot + PostgreSQL)
Dùng để trải nghiệm trọn vẹn vòng lặp gameplay: kết nối WebSocket Colyseus thời gian thực, lưu trữ dữ liệu bền vững vào PostgreSQL, 24 bot tự động khám phá và 16 tài khoản sinh viên.

#### Chạy nhanh với PowerShell (Local Fixture)
```powershell
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current'
npm run play:schools
```

* 🌐 **Web Client:** [**`http://127.0.0.1:4176/`**](http://127.0.0.1:4176/)
* 🔌 **Colyseus WebSocket:** Cổng `2568`
* 🛠️ **Admin Map Editor:** Bấm nút **Admin Map Editor** ở góc trái, nhập mật khẩu mặc định local: `dev-map-admin`

*(Xem thêm chi tiết thiết lập database riêng, cấu hình biến môi trường và chạy test tải tại [`README_PLAY.md`](README_PLAY.md)).*

---

## 2. Hướng dẫn Thao tác & Phím tắt trong Game

| Phím / Thao tác | Chức năng |
| :--- | :--- |
| **Chuột trái (Kéo)** | Lia bản đồ (Pan map). |
| **Cuộn chuột (Scroll)** | Thu phóng camera (Zoom in / Zoom out). |
| **Click ô đất (4-cạnh)** | Chọn ô để khám phá (**1 Point** nếu ô mới; **2 Points** nếu giao lưu ô trường đối thủ; **0 Point** nếu ô đã sở hữu). |
| **`H`** | Di chuyển camera về ngay **Trụ sở chính (HQ)** của trường bạn. |
| **`L`** | Di chuyển camera đến **Danh thắng / Landmark** gần nhất. |
| **`O`** | Thu phóng xem toàn cảnh bản đồ thế giới (Overview). |
| **`I`** | Chuyển đổi giữa góc nhìn **Isometric nghiêng 3D** và góc nhìn **Top-down từ trên xuống**. |
| **Minimap (góc dưới trái)** | Click vào minimap để dịch chuyển góc nhìn tức thì tới tọa độ đó. |

---

## 3. Các Cải tiến Đồ họa & Shader Mới nhất

1. **Hệ thống Chiếu sáng & Đổ bóng Mềm (Real-time Shadows):**
   * Kích hoạt `PCFSoftShadowMap` với shadow map 2048×2048.
   * Ánh sáng mặt trời (`DirectionalLight` 2.4) chiếu từ phía sau camera, đổ bóng công trình nghiêng về phía người chơi trong góc nhìn Isometric.
   * Frustum bóng tự động co giãn và di chuyển bám sát tầm nhìn camera, giữ cho bóng luôn sắc nét ở mọi mức zoom.
   * Mặt phẳng `ShadowMaterial` trong suốt đón bóng trực tiếp trên nền địa hình mà không làm biến đổi màu sương mù.
2. **Shader Viền Lãnh thổ & Sương mù Khám phá ([`tileFx.ts`](client/src/tileFx.ts)):**
   * **Đường viền lãnh thổ (Breathing Border):** Viền sáng nổi bật tự động nhận diện mép lãnh thổ trường, có nhịp thở nhẹ.
   * **Rãnh phân cách ô:** Hiệu ứng bevel mỏng giữa các ô đất giúp nhận diện rõ ranh giới từng ô.
   * **Frontier Glow:** Các ô sương mù tiếp giáp trực tiếp với lãnh thổ trường phát ra ánh sáng dịu cùng màu nhận diện, báo hiệu cho người chơi biết ô có thể mở tiếp theo.
   * **Hoạt ảnh Sóng Khám phá (Wave Ripple & Flash):** Khi một ô được mở thành công, ô sẽ chớp sáng và phát ra vòng sóng lan tỏa rộng 6 ô trong 1,4 giây; khi mất ô phát ra sóng cảnh báo màu cam đỏ.
   * **Hoa văn Giao lưu (Shared Knowledge):** Thay thế caro 1 ô bằng các đường sọc chéo 3 ô đan xen màu của 2 trường, dễ nhìn và không gây rối mắt.

---

## 4. Các Lệnh Kiểm thử & Xây dựng (Scripts)

```bash
# Kiểm tra kiểu dữ liệu tĩnh (TypeScript strict)
npm run typecheck

# Kiểm tra quy chuẩn mã nguồn (Biome linter)
npm run lint

# Chạy toàn bộ test suite (100+ tests)
npm test

# Build client production vào thư mục dist/client
npm run build:client

# Kiểm tra kích thước bundle
npm run report:size
```

---

## 5. Tài liệu Tham khảo Liên quan

* [`README_PLAY.md`](README_PLAY.md) — Sổ tay vận hành G-V1 đầy đủ, hướng dẫn tích hợp Campaign API, GLB Auto-loader và nghiệm thu 500-client load test.
* [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md) — Đặc tả luật game chính thức đã ký duyệt (`ruleVersion = 1`).
* [`shared/gameplay/gameConfig.ts`](shared/gameplay/gameConfig.ts) — Bảng cấu hình tập trung toàn bộ tham số gameplay (costs, timers, probabilities, footprints, coordinates).
* [`docs/COMPLETION_PROGRESS.md`](docs/COMPLETION_PROGRESS.md) — Tiến độ chi tiết 18 hành trình (PV01–PV18) và checklist G-V1.

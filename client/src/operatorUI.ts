import {
  GAME_CONFIG,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import { MapEditorPanel, type MapLayoutPayload } from "./ui/mapEditorPanel.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
export class OperatorUI {
  private key = "";
  private objects: WorldObject[] = [];
  private panel = new MapEditorPanel({
    onClose: () => this.preview([]),
    onItemRelocated: (item, x, z) => {
      this.objects = this.objects.map((o) =>
        (
          item.type === "hq"
            ? o.id === `hq-${item.schoolId}`
            : item.type === "landmark"
              ? o.id === item.landmarkId
              : o.id === item.id
        )
          ? { ...o, x, z }
          : o,
      );
      this.preview(this.objects);
    },
    onFocusItem: (i) => this.focus(i.x, i.y),
    onApplyToServer: (layout) => void this.publish(layout),
    onNotification: (msg) =>
      NotificationBanner.show({ title: "Map Editor", body: msg }),
  });
  private menu = document.createElement("details");
  constructor(
    private focus: (x: number, z: number) => void,
    private preview: (objects: readonly WorldObject[]) => void,
  ) {
    this.menu.className = "operator-menu";
    this.menu.innerHTML =
      '<summary>Admin Map Editor</summary><input type="password" aria-label="Admin key" placeholder="ADMIN_KEY"><button class="load">Mở editor</button><button class="rollback">Khôi phục layout trước</button><select aria-label="Object mới"><option value="unistop">UniStop</option><option value="chest">Chest</option></select><select aria-label="Tier mới"><option>aspire</option><option>nitro</option><option>predator</option></select><button class="place">Đặt object mới</button><input type="number" min="0" max="100000" aria-label="Gift stock staging" placeholder="Gift stock"><button class="stock">Cập nhật Gift stock staging</button><input aria-label="Tiêu đề thông báo" placeholder="Tiêu đề"><input aria-label="Nội dung thông báo" placeholder="Nội dung"><button class="notify">Gửi thông báo campaign</button><details class="gift-checkin-section" style="margin-top:12px;border-top:1px solid #334;padding-top:8px"><summary style="cursor:pointer;font-weight:600;color:#00e5ff">Tra cứu & Xác nhận Check-in Quà tặng</summary><div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap"><input type="text" class="gift-code-input" aria-label="Mã quà tặng" placeholder="R2PL-GIFT-XXXXXX" style="flex:1;min-width:140px"><button type="button" class="gift-lookup-btn">Tra cứu mã</button><button type="button" class="gift-list-btn">Danh sách gần đây</button></div><div class="gift-checkin-result" style="font-size:12px;margin-top:6px"></div></details><details class="bot-simulation-section" open style="margin-top:12px;border-top:1px solid rgba(0,229,255,0.3);padding-top:8px"><summary style="cursor:pointer;font-weight:600;color:#00e5ff;display:flex;justify-content:space-between;align-items:center;"><span>🤖 Giả lập 200 Bot</span><span class="operator-bot-status" style="font-size:9px;background:#1e293b;color:#94a3b8;padding:2px 6px;border-radius:4px;">DỪNG</span></summary><p style="font-size:11px;color:#94a3b8;margin:6px 0 8px;line-height:1.4">200 bot tự động mở ô theo chiến thuật tiến về tâm & UniStop để kiểm tra tải thực tế.</p><div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px">Số lượng:</span><select class="operator-bot-count" style="background:#162732;color:#cbe3ed;border:1px solid #ffffff20;border-radius:4px;padding:3px 6px;font-size:11px"><option value="200" selected>200 Bot (Toàn diện)</option><option value="100">100 Bot</option><option value="50">50 Bot</option><option value="24">24 Bot (Nhẹ)</option></select></div><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px">Tốc độ:</span><select class="operator-bot-speed" style="background:#162732;color:#cbe3ed;border:1px solid #ffffff20;border-radius:4px;padding:3px 6px;font-size:11px"><option value="realistic" selected>Thực tế (1-2s)</option><option value="slow">Thư thả (3-5s)</option><option value="fast">Thần tốc (0.5s)</option></select></div></div><div style="display:flex;gap:6px"><button type="button" class="operator-bot-start" style="flex:1;background:var(--cyan);color:#08131a;font-weight:600;padding:6px;border-radius:4px;cursor:pointer;border:none">▶ Bật Bot</button><button type="button" class="operator-bot-stop" style="flex:1;background:#334155;color:#f87171;font-weight:600;padding:6px;border-radius:4px;cursor:pointer;border:none" disabled>⏹ Dừng</button></div><div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#94a3b8;display:flex;justify-content:space-between"><span>Đang chạy: <strong class="op-bot-active" style="color:#fff">0</strong></span><span>Tốc độ: <strong class="op-bot-rate" style="color:var(--cyan)">0</strong>/s</span><span>Đã mở: <strong class="op-bot-tiles" style="color:var(--cyan-bright)">0</strong></span></div></details>';
    document.body.append(this.menu);
    this.menu.addEventListener("toggle", () => {
      if (this.menu.open)
        document
          .querySelector<HTMLDetailsElement>(".gameplay-menu")
          ?.removeAttribute("open");
    });
    this.menu
      .querySelector(".load")!
      .addEventListener("click", () => void this.load());
    this.menu
      .querySelector(".rollback")!
      .addEventListener(
        "click",
        () => void this.send({ action: "rollback" }, true),
      );
    this.menu.querySelector(".notify")!.addEventListener(
      "click",
      () =>
        void this.send(
          {
            action: "notify",
            title: (
              this.menu.querySelector(
                '[aria-label="Tiêu đề thông báo"]',
              ) as HTMLInputElement
            ).value,
            body: (
              this.menu.querySelector(
                '[aria-label="Nội dung thông báo"]',
              ) as HTMLInputElement
            ).value,
          },
          false,
        ),
    );
    this.menu.querySelector(".stock")!.addEventListener(
      "click",
      () =>
        void this.send(
          {
            action: "gift-stock",
            tier: (
              this.menu.querySelector(
                '[aria-label="Tier mới"]',
              ) as HTMLSelectElement
            ).value,
            amount: Number(
              (
                this.menu.querySelector(
                  '[aria-label="Gift stock staging"]',
                ) as HTMLInputElement
              ).value,
            ),
          },
          false,
        ),
    );
    this.menu.querySelector(".place")!.addEventListener("click", () => {
      if (!this.key) return;
      const kind = (
        this.menu.querySelector(
          '[aria-label="Object mới"]',
        ) as HTMLSelectElement
      ).value as "unistop" | "chest";
      const tier = (
        this.menu.querySelector('[aria-label="Tier mới"]') as HTMLSelectElement
      ).value as "aspire" | "nitro" | "predator";
      const o: WorldObject = {
        id: `${kind}-${crypto.randomUUID()}`,
        kind,
        tier,
        x: 500,
        z: 500,
        name: `${kind} ${tier}`,
        ...GAME_CONFIG.footprints[kind],
      };
      this.objects.push(o);
      this.update();
      this.preview(this.objects);
      this.panel.open();
      this.panel.startRelocate({
        id: o.id,
        type: kind,
        name: o.name,
        tier,
        x: o.x,
        y: o.z,
      });
    });
    this.menu.querySelector(".gift-lookup-btn")?.addEventListener("click", () => {
      const input = this.menu.querySelector(".gift-code-input") as HTMLInputElement;
      if (input?.value) void this.lookupGift(input.value.trim());
    });
    this.menu.querySelector(".gift-list-btn")?.addEventListener("click", () => {
      void this.listRecentGifts();
    });

    const opBotStart = this.menu.querySelector(".operator-bot-start") as HTMLButtonElement | null;
    const opBotStop = this.menu.querySelector(".operator-bot-stop") as HTMLButtonElement | null;
    const opBotCount = this.menu.querySelector(".operator-bot-count") as HTMLSelectElement | null;
    const opBotSpeed = this.menu.querySelector(".operator-bot-speed") as HTMLSelectElement | null;
    const opBotStatus = this.menu.querySelector(".operator-bot-status") as HTMLElement | null;
    const opBotActive = this.menu.querySelector(".op-bot-active") as HTMLElement | null;
    const opBotRate = this.menu.querySelector(".op-bot-rate") as HTMLElement | null;
    const opBotTiles = this.menu.querySelector(".op-bot-tiles") as HTMLElement | null;

    if (opBotStart && opBotStop) {
      const updateOpBotUI = (telemetry: {
        status?: string;
        activeBots?: number;
        actionsPerSecond?: number;
        totalActions?: number;
      }) => {
        const isRunning = telemetry.status === "running" || telemetry.status === "starting";
        opBotStart.disabled = isRunning;
        opBotStop.disabled = !isRunning;
        if (opBotCount) opBotCount.disabled = isRunning;
        if (opBotSpeed) opBotSpeed.disabled = isRunning;

        if (opBotStatus) {
          if (telemetry.status === "running") {
            opBotStatus.textContent = "ĐANG CHẠY";
            opBotStatus.style.background = "rgba(0, 229, 255, 0.2)";
            opBotStatus.style.color = "var(--cyan-bright)";
          } else if (telemetry.status === "starting") {
            opBotStatus.textContent = "KHỞI ĐỘNG";
            opBotStatus.style.background = "rgba(238, 203, 114, 0.2)";
            opBotStatus.style.color = "#eecb72";
          } else if (telemetry.status === "stopping") {
            opBotStatus.textContent = "ĐANG DỪNG";
            opBotStatus.style.background = "rgba(239, 68, 68, 0.2)";
            opBotStatus.style.color = "#f87171";
          } else {
            opBotStatus.textContent = "DỪNG";
            opBotStatus.style.background = "#1e293b";
            opBotStatus.style.color = "#94a3b8";
          }
        }
        if (opBotActive) opBotActive.textContent = String(telemetry.activeBots ?? 0);
        if (opBotRate) opBotRate.textContent = String(telemetry.actionsPerSecond ?? 0);
        if (opBotTiles) opBotTiles.textContent = String(telemetry.totalActions ?? 0);
      };

      const pollOpBotStatus = async () => {
        try {
          const res = await fetch("/api/fixture/bots");
          if (res.ok) {
            const data = await res.json();
            updateOpBotUI(data);
          }
        } catch {}
      };

      opBotStart.addEventListener("click", async () => {
        opBotStart.disabled = true;
        NotificationBanner.show({ title: "Bot Simulation", body: "Đang khởi động 200 bot mô phỏng..." });
        try {
          const res = await fetch("/api/fixture/bots/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              count: opBotCount ? Number(opBotCount.value) : 200,
              speed: opBotSpeed ? opBotSpeed.value : "realistic",
            }),
          });
          if (res.ok) {
            const data = await res.json();
            updateOpBotUI(data);
            NotificationBanner.show({ title: "Bot Simulation", body: "200 bot đã bắt đầu khám phá bản đồ!" });
          } else {
            NotificationBanner.show({ title: "Bot Simulation", body: "Chưa thể khởi động bot." });
            opBotStart.disabled = false;
          }
        } catch {
          NotificationBanner.show({ title: "Bot Simulation", body: "Lỗi kết nối khi bật bot." });
          opBotStart.disabled = false;
        }
      });

      opBotStop.addEventListener("click", async () => {
        opBotStop.disabled = true;
        NotificationBanner.show({ title: "Bot Simulation", body: "Đang dừng toàn bộ bot..." });
        try {
          const res = await fetch("/api/fixture/bots/stop", { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            updateOpBotUI(data);
            NotificationBanner.show({ title: "Bot Simulation", body: "Đã dừng mô phỏng bot." });
          }
        } catch {
          NotificationBanner.show({ title: "Bot Simulation", body: "Lỗi khi dừng bot." });
        }
      });

      window.setInterval(pollOpBotStatus, 2000);
      void pollOpBotStatus();
    }
  }
  get relocating(): boolean {
    return this.panel.isRelocating();
  }
  relocate(x: number, z: number): void {
    this.panel.completeRelocate(x, z);
  }
  private update(): void {
    this.panel.updateData(
      this.objects
        .filter((o) => o.kind === "hq")
        .map((o) => ({ schoolId: SCHOOLS[o.schoolSlot!]!.id, x: o.x, y: o.z })),
      this.objects
        .filter((o) => o.kind === "landmark")
        .map((o) => ({
          id: o.id,
          landmarkKey: o.id,
          x: o.x,
          y: o.z,
          maxCrystals: GAME_CONFIG.landmark.baseCrystals,
        })),
      this.objects
        .filter((o) => o.kind === "unistop")
        .map((o) => ({ id: o.id, name: o.name, tier: o.tier, x: o.x, z: o.z })),
      this.objects
        .filter((o) => o.kind === "chest")
        .map((o) => ({ id: o.id, tier: o.tier, x: o.x, z: o.z })),
    );
  }
  private async load(): Promise<void> {
    this.key = (
      this.menu.querySelector('[aria-label="Admin key"]') as HTMLInputElement
    ).value;
    try {
      const r = await fetch("/api/admin", {
        headers: { "X-Admin-Key": this.key },
      });
      if (!r.ok) throw new Error(`Admin ${r.status}`);
      this.objects = ((await r.json()) as { objects: WorldObject[] }).objects;
      this.update();
      this.panel.open();
      this.preview(this.objects);
    } catch (e) {
      this.key = "";
      NotificationBanner.show({ title: "Admin", body: String(e) });
    }
  }
  private async publish(layout: MapLayoutPayload): Promise<void> {
    const objects = this.objects.map((o) => {
      const p =
        o.kind === "hq"
          ? layout.hqs?.find((p) => p.schoolId === SCHOOLS[o.schoolSlot!]!.id)
          : o.kind === "landmark"
            ? layout.landmarks?.find((p) => p.id === o.id)
            : o.kind === "unistop"
              ? layout.unistops?.find((p) => p.id === o.id)
              : layout.chests?.find((p) => p.id === o.id);
      return p ? { ...o, x: p.x, z: "z" in p ? p.z : p.y } : o;
    });
    await this.send({ action: "publish", objects }, true);
  }
  private async send(body: unknown, reload: boolean): Promise<void> {
    if (!this.key) {
      NotificationBanner.show({
        title: "Admin",
        body: "Mở editor bằng ADMIN_KEY trước",
      });
      return;
    }
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: {
          "X-Admin-Key": this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(result.error ?? `Admin ${r.status}`);
      NotificationBanner.show({
        title: "Admin",
        body: "Đã commit vào PostgreSQL",
      });
      if (reload) location.reload();
    } catch (e) {
      NotificationBanner.show({ title: "Admin", body: String(e) });
    }
  }

  private async lookupGift(code: string): Promise<void> {
    const adminKey =
      this.key ||
      (this.menu.querySelector('[aria-label="Admin key"]') as HTMLInputElement)
        ?.value;
    if (!adminKey) {
      NotificationBanner.show({
        title: "Admin",
        body: "Nhập ADMIN_KEY trước khi tra cứu quà tặng",
      });
      return;
    }
    this.key = adminKey;
    const container = this.menu.querySelector(".gift-checkin-result");
    if (!container) return;
    container.innerHTML = "<em>Đang tra cứu...</em>";
    try {
      const res = await fetch(
        `/api/admin/gifts?code=${encodeURIComponent(code)}`,
        { headers: { "X-Admin-Key": this.key } },
      );
      if (res.status === 404) {
        container.innerHTML =
          '<p style="color:#ff657a">❌ Không tìm thấy mã quà tặng này trong hệ thống.</p>';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { gift: Record<string, unknown> };
      const gift = data.gift;
      this.renderGiftDetail(container, gift);
    } catch (e) {
      container.innerHTML = `<p style="color:#ff657a">Lỗi: ${String(e)}</p>`;
    }
  }

  private async listRecentGifts(): Promise<void> {
    const adminKey =
      this.key ||
      (this.menu.querySelector('[aria-label="Admin key"]') as HTMLInputElement)
        ?.value;
    if (!adminKey) {
      NotificationBanner.show({
        title: "Admin",
        body: "Nhập ADMIN_KEY trước",
      });
      return;
    }
    this.key = adminKey;
    const container = this.menu.querySelector(".gift-checkin-result");
    if (!container) return;
    container.innerHTML = "<em>Đang tải danh sách...</em>";
    try {
      const res = await fetch("/api/admin/gifts", {
        headers: { "X-Admin-Key": this.key },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { gifts: Record<string, unknown>[] };
      if (!data.gifts || data.gifts.length === 0) {
        container.innerHTML = "<p>Chưa có quà tặng nào được trúng.</p>";
        return;
      }
      container.innerHTML = "";
      const list = document.createElement("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "6px";
      for (const gift of data.gifts) {
        const item = document.createElement("div");
        item.style.padding = "6px 8px";
        item.style.background = "#13232c";
        item.style.borderRadius = "4px";
        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.alignItems = "center";
        const isRedeemed = !!gift.redeemedAt;
        item.innerHTML = `
          <div>
            <b>${gift.giftCode || gift.id}</b> · <span style="text-transform:uppercase">${gift.tier}</span> · ${gift.schoolName || `Slot ${gift.schoolSlot}`}
            <br><small style="color:${isRedeemed ? "#5fffd0" : "#ffcc66"}">${isRedeemed ? "✓ Đã phát quà" : "⏳ Chưa nhận"}</small>
          </div>
        `;
        const selectBtn = document.createElement("button");
        selectBtn.textContent = "Xem";
        selectBtn.type = "button";
        selectBtn.style.padding = "2px 8px";
        selectBtn.onclick = () => this.renderGiftDetail(container, gift);
        item.append(selectBtn);
        list.append(item);
      }
      container.append(list);
    } catch (e) {
      container.innerHTML = `<p style="color:#ff657a">Lỗi: ${String(e)}</p>`;
    }
  }

  private renderGiftDetail(
    container: Element,
    gift: Record<string, unknown>,
  ): void {
    container.innerHTML = "";
    const card = document.createElement("div");
    card.style.padding = "10px";
    card.style.background = "#13232c";
    card.style.border = "1px solid #234";
    card.style.borderRadius = "6px";
    card.style.marginTop = "6px";

    const isRedeemed = !!gift.redeemedAt;
    const timeStr = gift.createdAt
      ? new Date(Number(gift.createdAt)).toLocaleString("vi-VN")
      : "—";
    const redeemedStr = isRedeemed
      ? new Date(Number(gift.redeemedAt)).toLocaleString("vi-VN")
      : "—";

    card.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:#00e5ff;margin-bottom:6px">
        🎁 ${gift.giftCode || gift.id}
      </div>
      <div><b>Tier:</b> <span style="text-transform:uppercase;color:#ffd700">${gift.tier}</span></div>
      <div><b>Trường:</b> ${gift.schoolName || `Slot ${gift.schoolSlot}`}</div>
      <div><b>Sinh viên (Actor):</b> <code style="font-size:11px">${gift.actorId}</code></div>
      <div><b>Thời gian trúng:</b> ${timeStr}</div>
      <div style="margin-top:6px"><b>Trạng thái:</b> 
        <span style="font-weight:600;color:${isRedeemed ? "#5fffd0" : "#ffcc66"}">
          ${isRedeemed ? `✓ ĐÃ PHÁT QUÀ (${redeemedStr})` : "⏳ CHƯA NHẬN QUÀ"}
        </span>
      </div>
    `;

    if (!isRedeemed) {
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = "✓ Xác nhận đã phát quà";
      confirmBtn.style.marginTop = "10px";
      confirmBtn.style.padding = "6px 14px";
      confirmBtn.style.background = "#00a86b";
      confirmBtn.style.color = "#fff";
      confirmBtn.style.border = "none";
      confirmBtn.style.borderRadius = "4px";
      confirmBtn.style.cursor = "pointer";
      confirmBtn.style.fontWeight = "600";
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Đang xử lý...";
        await this.confirmRedeem(String(gift.giftCode || gift.id), container);
      };
      card.append(confirmBtn);
    }

    container.append(card);
  }

  private async confirmRedeem(
    giftCode: string,
    container: Element,
  ): Promise<void> {
    try {
      const res = await fetch("/api/admin/gifts/redeem", {
        method: "POST",
        headers: {
          "X-Admin-Key": this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ giftCode }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        alreadyRedeemed?: boolean;
        gift?: Record<string, unknown>;
        error?: string;
      };
      if (data.success && data.gift) {
        NotificationBanner.show({
          title: "Check-in quà tặng",
          body: `Đã xác nhận phát quà thành công cho mã ${giftCode}!`,
        });
        this.renderGiftDetail(container, data.gift);
      } else if (data.alreadyRedeemed && data.gift) {
        NotificationBanner.show({
          title: "Check-in quà tặng",
          body: `Mã ${giftCode} đã được nhận trước đó.`,
        });
        this.renderGiftDetail(container, data.gift);
      } else {
        throw new Error(data.error ?? "Failed to redeem");
      }
    } catch (e) {
      NotificationBanner.show({
        title: "Lỗi phát quà",
        body: String(e),
      });
    }
  }
}

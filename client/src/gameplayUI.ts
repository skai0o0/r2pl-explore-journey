import type {
  GameCommand,
  GameReceipt,
  GameView,
} from "../../shared/gameplay/commands.ts";
import {
  GAME_CONFIG,
  LANDMARKS,
  type RewardOutcome,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import {
  LANDMARK_HINTS,
  LANDMARK_PUZZLES,
} from "../../shared/gameplay/landmarkPuzzle.ts";
import type { DevPlayer } from "../../shared/integration/devSession.ts";
import { CarouselModal } from "./ui/carouselModal.ts";
import { LandmarkModal } from "./ui/landmarkModal.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
import { UniStopModal } from "./ui/uniStopModal.ts";
import type { LootItem } from "./ui/v1Adapters.ts";
import "./ui/v1.css";
export class GameplayUI {
  private player: DevPlayer | undefined;
  private view: GameView | undefined;
  private generation = 0;
  private refreshRequest = 0;
  private busy = false;
  private chestDialog: HTMLDialogElement | undefined;
  private panel = document.createElement("details");
  private seen = new Set<string>();
  private landmark = new LandmarkModal({
    onContributeCrystal: (id, amount) =>
      void this.command({ action: "contribute", target: id, amount }),
    onGuessLandmark: (id, guess) =>
      void this.command({ action: "guess", target: id, guess }),
    onFocusLandmark: (x, z) => this.focus(x, z),
  });
  private unistop = new UniStopModal(
    (id) => void this.command({ action: "spin", target: id }),
  );
  private carousel = new CarouselModal();
  constructor(
    private objects: readonly WorldObject[],
    private focus: (x: number, z: number) => void,
    private onView: (view: GameView) => void,
    private onWallet: () => void,
    private scope = "",
    private onChestOpened?: (id: string) => void,
  ) {
    this.panel.className = "gameplay-menu";
    this.panel.innerHTML =
      '<summary>Địa danh · Tiếp tế · Running</summary><div class="gameplay-navigation"><input type="number" min="0" max="999" aria-label="Tọa độ X" placeholder="X"><input type="number" min="0" max="999" aria-label="Tọa độ Z" placeholder="Z"><button type="button">Đi tới ô</button></div><details class="gameplay-guide"><summary>Hướng dẫn chơi</summary><p>Khám phá ô kề 4 cạnh: 1 Point. Ô của trường mình: 0 Point. Giao lưu ô một trường khác: 2 Points, tối đa hai trường.</p><p>Shared Knowledge miễn upkeep 24 giờ đầu, sau đó 1 Point mỗi 24 giờ cho mỗi cluster. Incumbent hết hạn: guest góp ceil(số ô / 2) trong 48 giờ, rolling timer 2 giờ; quá hạn hoàn Points.</p><p>Giải đố địa danh để nhận 10% mốc vào Crystal pot của trường; cần Knowledge chạm địa danh. Nạp Crystal để thắp Beacon; takeover tăng mốc 5% base.</p><p>Quay Aspire/Nitro/Predator để nhận tài nguyên, Keys và Treasure Map. Map chỉ ra Chest riêng của bạn. Chest cần 1 Key đúng tier. Chạy giả lập để sync Points vào ví và đủ điều kiện Gift staging.</p><p>Kéo để lia, cuộn để zoom; H về HQ, L đến địa danh, O toàn bản đồ, I đổi camera. Bản đồ nhỏ có thể bấm để dẫn đường.</p></details><div class="gameplay-content"></div>';
    document.body.append(this.panel);
    this.panel.addEventListener("toggle", () => {
      if (this.panel.open)
        document
          .querySelector<HTMLDetailsElement>(".operator-menu")
          ?.removeAttribute("open");
    });
    this.panel
      .querySelector(".gameplay-navigation button")!
      .addEventListener("click", () => {
        const x = Number(
            (
              this.panel.querySelector(
                '[aria-label="Tọa độ X"]',
              ) as HTMLInputElement
            ).value,
          ),
          z = Number(
            (
              this.panel.querySelector(
                '[aria-label="Tọa độ Z"]',
              ) as HTMLInputElement
            ).value,
          );
        if (
          Number.isInteger(x) &&
          Number.isInteger(z) &&
          x >= 0 &&
          z >= 0 &&
          x < 1000 &&
          z < 1000
        )
          this.focus(x + 0.5, z + 0.5);
      });
    window.setInterval(() => {
      if (this.player) void this.refresh();
    }, 5000);
  }
  get open(): boolean {
    return (
      this.landmark.isVisible() ||
      this.unistop.isOpen() ||
      this.carousel.isOpen() ||
      !!this.chestDialog?.open
    );
  }
  select(player: DevPlayer): void {
    this.player = player;
    this.view = undefined;
    this.generation++;
    this.busy = false;
    this.landmark.close();
    this.unistop.close();
    this.carousel.close();
    this.chestDialog?.close();
    this.chestDialog?.remove();
    this.chestDialog = undefined;
    NotificationBanner.clearAll();
    this.seen = new Set(
      JSON.parse(
        sessionStorage.getItem(`events-${this.scope}-${player.token}`) ?? "[]",
      ) as string[],
    );
    this.render();
    void this.refresh();
  }
  private data(id: string) {
    const v = this.view?.landmarks.find((l) => l.id === id),
      l = LANDMARKS.find((l) => l.id === id);
    if (!v || !l || !this.player) return;
    const school = SCHOOLS[this.player.slot]!.id;
    return {
      landmarkId: id,
      landmarkKey: id,
      name: l.name,
      hint: LANDMARK_HINTS[id],
      story: LANDMARK_PUZZLES[id]?.story,
      hints: LANDMARK_PUZZLES[id]?.hints,
      category: l.category,
      footprint: GAME_CONFIG.footprints.landmark,
      buffDescription: l.buffDescription,
      gameplayRole: l.gameplayRole,
      x: this.objects.find((o) => o.id === id)?.x ?? l.x,
      y: this.objects.find((o) => o.id === id)?.z ?? l.z,
      currentCrystals: v.pot,
      maxCrystals: v.target,
      litBySchoolId: v.holder === null ? "" : SCHOOLS[v.holder]!.id,
      buffActive: v.holder === this.player.slot,
      crystalsBySchool: { [school]: v.pot },
      userPoints: 0,
      userCrystals: Number(this.view!.crystals),
      playerSchoolId: school,
      hasPath: v.hasPath,
      nameGuessed: v.solved,
      guessedBySchoolId: v.solved ? school : "",
      guessCooldownUntil: v.cooldownUntil,
    };
  }
  pick(o: WorldObject): void {
    if (o.kind === "landmark") {
      const d = this.data(o.id);
      if (d) this.landmark.open(d);
    } else if (o.kind === "unistop" && o.tier && this.player && this.view) {
      const ownerId =
        o.ownerSchoolId ??
        (o.ownerSchoolSlot !== null && o.ownerSchoolSlot !== undefined
          ? SCHOOLS[o.ownerSchoolSlot]?.id
          : null);
      this.unistop.open({
        id: o.id,
        tier: o.tier,
        ownerSchoolId: ownerId,
        schoolId: SCHOOLS[this.player.slot]!.id,
        cooldownUntil: this.view.cooldowns[o.id] ?? 0,
        profileReady: true,
        hasWeeklyRunningPoints: this.view.weeklyKm > 0,
      });
    } else if (o.kind === "chest") {
      this.chestDialog?.close();
      this.chestDialog?.remove();
      const dialog = document.createElement("dialog");
      this.chestDialog = dialog;
      dialog.className = "chest-dialog";
      const title = document.createElement("h2");
      title.textContent = o.name;
      const info = document.createElement("p");
      info.textContent = `Mở rương: ${GAME_CONFIG.rewards.chestKeyCost} Key ${o.tier}`;
      const button = document.createElement("button");
      button.textContent = "Mở Chest";
      button.disabled =
        !o.tier ||
        Number(this.view?.keys[o.tier] ?? 0) < GAME_CONFIG.rewards.chestKeyCost;
      button.onclick = () => {
        dialog.close();
        dialog.remove();
        void this.command({ action: "open", target: o.id });
      };
      const close = document.createElement("button");
      close.textContent = "Đóng";
      close.onclick = () => {
        dialog.close();
        dialog.remove();
      };
      dialog.append(title, info, button, close);
      document.body.append(dialog);
      dialog.showModal();
    }
  }
  async refresh(): Promise<void> {
    if (!this.player) return;
    const token = this.player.token,
      generation = this.generation;
    const request = ++this.refreshRequest;
    try {
      const r = await fetch("/api/game", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`Gameplay ${r.status}`);
      const view = (await r.json()) as GameView;
      if (generation !== this.generation || request !== this.refreshRequest)
        return;
      this.view = view;
      this.onView(view);
      this.onWallet();
      this.render();
      const id = this.landmark.getCurrentLandmarkId();
      if (id && this.landmark.isVisible()) {
        const d = this.data(id);
        if (d) this.landmark.update(d);
      }
      const stopId = this.unistop.getStopId();
      if (stopId && this.unistop.isOpen()) {
        const o = this.objects.find((x) => x.id === stopId);
        if (o && o.tier) {
          const ownerId =
            o.ownerSchoolId ??
            (o.ownerSchoolSlot !== null && o.ownerSchoolSlot !== undefined
              ? SCHOOLS[o.ownerSchoolSlot]?.id
              : null);
          this.unistop.update({
            id: o.id,
            tier: o.tier,
            ownerSchoolId: ownerId,
            schoolId: SCHOOLS[this.player.slot]!.id,
            cooldownUntil: view.cooldowns[o.id] ?? 0,
            profileReady: true,
            hasWeeklyRunningPoints: view.weeklyKm > 0,
          });
        }
      }
      const unseen = [...view.events]
        .reverse()
        .filter((e) => !this.seen.has(e.id));
      for (const e of unseen) this.seen.add(e.id);
      for (const e of unseen.slice(-3))
        NotificationBanner.show({ title: e.title, body: e.body });
      sessionStorage.setItem(
        `events-${this.scope}-${token}`,
        JSON.stringify([...this.seen].slice(-200)),
      );
    } catch {
      if (generation === this.generation && request === this.refreshRequest)
        this.panel.querySelector(".gameplay-content")!.textContent =
          "Chưa đồng bộ gameplay · tự động thử lại";
    }
  }
  private loot(r: RewardOutcome): LootItem {
    return {
      id: `${r.kind}-${r.quantity}`,
      name: r.kind === "gift" ? "Gift (staging)" : `${r.kind} ×${r.quantity}`,
      type:
        r.kind === "crystals"
          ? "crystal"
          : r.kind === "gift"
            ? "real_gift"
            : r.kind,
      description:
        r.kind === "gift"
          ? "Gift giả lập đã lưu trong hành trang của bạn."
          : "Phần thưởng đã được cộng vào ví đang chơi.",
      rarity:
        r.kind === "gift" ? "legendary" : r.quantity >= 4 ? "epic" : "common",
      amount: r.quantity,
      weight: r.weight,
    };
  }
  async command(
    fields: Omit<GameCommand, "ruleVersion" | "key">,
  ): Promise<void> {
    if (!this.player || this.busy) return;
    this.busy = true;
    const generation = this.generation,
      token = this.player.token;
    const storage = `pending-game-${this.scope}-${token}`;
    const c: GameCommand = {
      ruleVersion: 1,
      key: crypto.randomUUID(),
      ...fields,
    };
    const existing = sessionStorage.getItem(storage);
    if (existing && JSON.parse(existing).key !== c.key) {
      this.busy = false;
      NotificationBanner.show({
        title: "Lệnh chưa xác nhận",
        body: "Gửi lại lệnh đang chờ trước khi thực hiện thao tác mới",
      });
      return;
    }
    sessionStorage.setItem(storage, JSON.stringify(c));
    try {
      const r = await fetch("/api/game", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(c),
      });
      if (!r.ok) throw new Error(`Gameplay ${r.status}`);
      const receipt = (await r.json()) as GameReceipt;
      if (
        sessionStorage.getItem(storage) &&
        JSON.parse(sessionStorage.getItem(storage)!).key === c.key
      )
        sessionStorage.removeItem(storage);
      if (generation !== this.generation) return;

      if (receipt.reward) {
        this.unistop.close();
        const o =
          this.objects.find((o) => o.id === c.target) ??
          this.view?.chests.find((o) => o.id === c.target);
        const rows =
          GAME_CONFIG.rewards[c.action === "open" ? "chest" : "unistop"][
            o?.tier ?? "aspire"
          ].outcomes;
        const winner = this.loot(receipt.reward),
          items = Array.from({ length: 30 }, (_, i) =>
            i === 24
              ? winner
              : this.loot(
                  rows.filter((row) => row.weight > 0)[
                    i % rows.filter((row) => row.weight > 0).length
                  ]!,
                ),
          );
        this.carousel.spin({
          title: o?.name ?? "Phần thưởng",
          sourceType: c.action === "open" ? "chest" : "unistop",
          tier: o?.tier ?? "aspire",
          items,
          winningIndex: 24,
          winningItem: winner,
        });
        if (c.action === "open" && c.target) {
          this.onChestOpened?.(c.target);
        }
      }
      if (receipt.discovery)
        this.focus(receipt.discovery.x, receipt.discovery.z);
      await this.refresh();
    } catch {
      if (generation === this.generation)
        NotificationBanner.show({
          title: "Chưa nhận được xác nhận",
          body: "Lệnh được giữ để gửi lại bằng cùng key khi kết nối lại.",
        });
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.unistop.finishRequest();
      }
    }
  }
  private render(): void {
    const content = this.panel.querySelector(".gameplay-content")!;
    const scroll = content.scrollTop;
    content.replaceChildren();
    const storage = this.player
      ? `pending-game-${this.scope}-${this.player.token}`
      : "";
    const pending = sessionStorage.getItem(storage);
    if (pending) {
      const retry = document.createElement("button");
      retry.textContent = "Gửi lại lệnh đang chờ";
      retry.onclick = () =>
        void this.command(JSON.parse(pending) as GameCommand);
      content.append(retry);
    }
    const inventory = document.createElement("p");
    inventory.textContent =
      "Crystal " +
      (this.view?.crystals ?? "—") +
      " · Maps " +
      (this.view?.treasureMaps ?? "—") +
      " · Keys A/N/P " +
      (this.view ? Object.values(this.view.keys).join("/") : "—");
    content.append(inventory);
    const gifts = this.view?.gifts ?? [];
    if (gifts.length > 0) {
      const section = document.createElement("div");
      section.className = "gift-inventory-section";
      section.style.cssText =
        "margin:10px 0;padding:10px;background:#0d232e;border:1px solid #1a3c4f;border-radius:6px;";
      const heading = document.createElement("div");
      heading.style.cssText =
        "font-weight:700;color:#00e5ff;margin-bottom:8px;font-size:13px;display:flex;align-items:center;gap:6px;";
      heading.innerHTML = "🎁 <span>Kho Quà Hiện Vật & Check-in</span>";
      section.append(heading);

      for (const gift of gifts) {
        const card = document.createElement("div");
        card.style.cssText =
          "background:#142d3b;border-radius:4px;padding:8px;margin-bottom:6px;font-size:12px;border-left:3px solid #ffcc66;";
        const isRedeemed = !!gift.redeemedAt;
        const code = gift.giftCode || gift.id;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-weight:700;color:#ffd700;text-transform:uppercase">${gift.tier} GIFT</span>
            <span style="font-size:11px;font-weight:600;color:${isRedeemed ? "#5fffd0" : "#ff9d00"}">
              ${isRedeemed ? "✓ ĐÃ NHẬN" : "⏳ CHỜ CHECK-IN"}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin:4px 0">
            <span style="color:#aaa;font-size:11px">Mã đối soát:</span>
            <code style="background:#09151c;padding:2px 6px;border-radius:3px;color:#00e5ff;font-weight:700;letter-spacing:1px">${code}</code>
            <button type="button" class="copy-gift-btn" style="padding:2px 8px;font-size:11px;cursor:pointer">Sao chép</button>
          </div>
          <small style="color:#88a">
            ${isRedeemed ? `Đã nhận quà tại sự kiện (${new Date(Number(gift.redeemedAt)).toLocaleString("vi-VN")})` : "Đưa mã này cho Ban tổ chức tại sự kiện để nhận quà"}
          </small>
        `;
        const copyBtn = card.querySelector(
          ".copy-gift-btn",
        ) as HTMLButtonElement;
        copyBtn?.addEventListener("click", () => {
          if (navigator.clipboard) {
            void navigator.clipboard.writeText(code);
            NotificationBanner.show({
              title: "Kho đồ",
              body: `Đã sao chép mã quà tặng: ${code}`,
            });
          }
        });
        section.append(card);
      }
      content.append(section);
    }
    const running = document.createElement("button");
    running.textContent =
      this.view?.runningMode === "http"
        ? "Đồng bộ Running từ chiến dịch"
        : `Chạy giả lập 1 km · +${GAME_CONFIG.running.kmToPointsRate} Points`;
    running.onclick = () =>
      void this.command({
        action: "running",
        ...(this.view?.runningMode === "http" ? {} : { amount: 1000 }),
      });
    content.append(running);
    const km = document.createElement("p");
    km.textContent = `Tuần này: ${this.view?.weeklyKm ?? 0} km`;
    content.append(km);
    for (const cluster of this.view?.shared ?? []) {
      const box = document.createElement("div");
      const text = document.createElement("p");
      text.textContent = `${cluster.pair.map((s) => SCHOOLS[s]!.shortName).join(" + ")} · ${cluster.tiles} ô · ${cluster.status === "shared" ? `Upkeep hạn ${new Date(cluster.due).toLocaleString()}` : `Consolidation ${cluster.contributed}/${cluster.required} · hết hạn ${new Date(Math.min(cluster.hardUntil, cluster.rollingUntil)).toLocaleString()}`}`;
      const pay = document.createElement("button");
      pay.textContent =
        cluster.status === "shared"
          ? `Đóng upkeep ${GAME_CONFIG.knowledge.upkeepPoints} Point`
          : "Đóng góp consolidation 1 Point";
      pay.disabled =
        cluster.status === "shared"
          ? Date.now() < cluster.freeUntil
          : cluster.guest !== this.player?.slot;
      if (cluster.status === "shared" && pay.disabled)
        pay.textContent = `Miễn upkeep đến ${new Date(cluster.freeUntil).toLocaleString()}`;
      if (cluster.status !== "shared" && pay.disabled)
        pay.textContent = "Guest đang đóng góp consolidation";
      pay.onclick = () =>
        void this.command({
          action: cluster.status === "shared" ? "upkeep" : "consolidate",
          target: cluster.id,
          amount: 1,
        });
      box.append(text, pay);
      content.append(box);
    }
    for (const o of [
      ...this.objects.filter((o) => o.kind !== "hq"),
      ...(this.view?.chests ?? []),
    ]) {
      const row = document.createElement("div"),
        focus = document.createElement("button"),
        open = document.createElement("button");
      focus.textContent = "⌖";
      focus.title = `Đi tới ${o.name}`;
      focus.onclick = () => this.focus(o.x, o.z);
      open.textContent =
        o.kind === "chest" ? `${o.name} · (${o.x}, ${o.z})` : o.name;
      open.onclick = () => this.pick(o);
      row.append(focus, open);
      content.append(row);
    }
    const history = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Lịch sử & thông báo";
    history.append(summary);
    for (const event of this.view?.events ?? []) {
      const row = document.createElement("p");
      row.textContent = `${event.title} · ${event.body}`;
      history.append(row);
    }
    content.append(history);
    content.scrollTop = scroll;
  }
}

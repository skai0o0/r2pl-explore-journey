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
import { effectiveRewardOutcomes } from "../../shared/gameplay/giftPool.ts";
import {
  LANDMARK_HINTS,
  LANDMARK_PUZZLES,
} from "../../shared/gameplay/landmarkPuzzle.ts";
import type { DevPlayer } from "../../shared/integration/devSession.ts";
import { gameFetch } from "./gameHttp.ts";
import { CarouselModal } from "./ui/carouselModal.ts";
import { ChestModal } from "./ui/chestModal.ts";
import { LandmarkModal } from "./ui/landmarkModal.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
import {
  notifyActionError,
  notifyActionSuccess,
  notifyGameEvent,
} from "./ui/notifications.ts";
import {
  campaignDisplayText,
  objectDisplayName,
} from "./ui/playerPresentation.ts";
import { UniStopModal } from "./ui/uniStopModal.ts";
import type { LootItem } from "./ui/v1Adapters.ts";
import "./ui/v1.css";
import { Icons } from "./ui/icons.ts";
import { preserveSurface, UiOverlay } from "./ui/overlay.ts";
export class GameplayUI {
  public onFindExpansion?: () => void;
  private player: DevPlayer | undefined;
  private view: GameView | undefined;
  private generation = 0;
  private refreshRequest = 0;
  private busy = false;
  private _chestModal: ChestModal | undefined;
  private get chestModal(): ChestModal {
    this._chestModal ??= new ChestModal({
      onOpenChest: (id) => void this.command({ action: "open", target: id }),
      onFindKey: (tier) => {
        const stop = this.objects.find(
          (o) =>
            o.kind === "unistop" && o.tier === tier && this.canShowObject(o),
        );
        if (stop) this.focus(stop.x, stop.z);
      },
      onGuidePath: (x, z) => this.onGuidePath?.(x, z),
    });
    return this._chestModal;
  }
  private panel = document.createElement("details");
  private journey: UiOverlay;
  private seen = new Set<string>();
  private _landmark: LandmarkModal | undefined;
  private get landmark(): LandmarkModal {
    this._landmark ??= new LandmarkModal({
      onContributeCrystal: (id, amount) =>
        void this.command({ action: "contribute", target: id, amount }),
      onGuessLandmark: (id, guess) =>
        void this.command({ action: "guess", target: id, guess }),
      onRally: (id) => void this.command({ action: "rally", target: id }),
      onFocusLandmark: (x, z) => this.focus(x, z),
      onGuidePath: (x, z) => this.onGuidePath?.(x, z),
    });
    return this._landmark;
  }
  private _unistop: UniStopModal | undefined;
  private get unistop(): UniStopModal {
    this._unistop ??= new UniStopModal({
      onClaim: (id) => void this.command({ action: "spin", target: id }),
      onGuidePath: (x, z) => this.onGuidePath?.(x, z),
      onSyncRunning: () => this.onSyncRunning?.(),
    });
    return this._unistop;
  }
  private _carousel: CarouselModal | undefined;
  private get carousel(): CarouselModal {
    this._carousel ??= new CarouselModal();
    return this._carousel;
  }
  constructor(
    private objects: readonly WorldObject[],
    private focus: (x: number, z: number) => void,
    private onView: (view: GameView) => void,
    private onWallet: () => void,
    private scope = "",
    private onChestOpened?: (id: string) => void,
    private devMode = false,
    private visibleObject: (object: WorldObject) => boolean = () => true,
    private onGuidePath?: (x: number, z: number) => void,
    private onSyncRunning?: () => void,
  ) {
    this.panel.className = "gameplay-menu";
    this.panel.innerHTML =
      '<summary>Hành trình & nhiệm vụ</summary><div class="gameplay-navigation"><input type="number" min="0" max="999" aria-label="Tọa độ X" placeholder="X"><input type="number" min="0" max="999" aria-label="Tọa độ Z" placeholder="Z"><button type="button">Đi tới ô</button></div><details class="gameplay-guide"><summary>Hướng dẫn chơi</summary><p>Khám phá ô chung cạnh để mở rộng tri thức. Ô mới cần 1 Điểm; giao lưu ô của một trường khác cần 2 Điểm. Ô của trường mình không mất Điểm.</p><p>Chạm ô để xem hành động phù hợp. Bật Mở Nhanh 1 Chạm để tự mở ô trống hợp lệ.</p><p>Tri thức chung miễn duy trì 24 giờ đầu, sau đó cần 1 Điểm mỗi ngày. Theo dõi hạn và góp Điểm trong mục tri thức chung.</p><p>Mở đường tới công trình, giải đố và góp Tinh Thể để thắp Đèn Hiệu cho trường. Nhận tài nguyên tại trạm tiếp tế; Bản Đồ Kho Báu chỉ ra rương riêng của bạn. Mở rương bằng Chìa Khóa cùng cấp.</p><p>Thành tích chạy trong tuần là điều kiện nhận quà hiện vật. Kéo để lia, cuộn để phóng to; H về trụ sở, L đến công trình, O xem toàn bản đồ, I đổi góc nhìn.</p></details><div class="gameplay-content"></div>';
    if (!this.devMode) {
      this.panel.querySelector(".gameplay-navigation")?.remove();
    }
    this.panel.hidden = true;
    document.body.append(this.panel);
    this.journey = new UiOverlay(
      this.panel,
      () => this.closeJourney(),
      "Hành trình của trường",
    );
    const close = document.createElement("button");
    close.className = "icon-button journey-close";
    close.type = "button";
    close.setAttribute("aria-label", "Đóng hành trình");
    close.dataset.autofocus = "true";
    close.innerHTML = Icons.close(18);
    close.onclick = () => this.closeJourney();
    this.panel.append(close);
    this.panel.addEventListener("toggle", () => {
      if (!this.panel.open) this.closeJourney();
      if (this.panel.open)
        document
          .querySelector<HTMLDetailsElement>(".operator-menu")
          ?.removeAttribute("open");
    });
    this.panel
      .querySelector(".gameplay-navigation button")
      ?.addEventListener("click", () => {
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
      if (this.player && !document.hidden) void this.refresh();
    }, 5000);
  }
  openInventory(): void {
    this.panel.hidden = false;
    this.panel.open = true;
    this.render();
    this.journey.open();
  }
  private closeJourney(): void {
    this.panel.open = false;
    this.panel.hidden = true;
    this.journey.close();
  }
  canShowObject(object: WorldObject): boolean {
    return this.devMode || this.visibleObject(object);
  }
  objectName(object: WorldObject): string {
    return objectDisplayName(
      object,
      object.kind !== "landmark" ||
        !!this.view?.landmarks.find((l) => l.id === object.id)?.solved,
    );
  }
  get open(): boolean {
    return !!(
      this._landmark?.isVisible() ||
      this._unistop?.isOpen() ||
      this._carousel?.isOpen() ||
      this._chestModal?.isVisible()
    );
  }
  select(player: DevPlayer): void {
    this.closeJourney();
    this.player = player;
    this.view = undefined;
    this.generation++;
    this.busy = false;
    this._landmark?.setPending(false);
    this._landmark?.close();
    this._unistop?.close();
    this._carousel?.close();
    this._chestModal?.close();
    NotificationBanner.clearAll();
    this.seen = new Set(
      JSON.parse(
        sessionStorage.getItem(`events-${this.scope}-${player.token}`) ?? "[]",
      ) as string[],
    );
    if (this.panel.open) this.render();
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
      buffDescription: v.buff
        ? `${v.buff.name}: ${v.buff.description}`
        : "Đặc quyền được xác định khi thắp Đèn hiệu.",
      contributionCapacity: Number(
        this.view?.contributionCapacity ?? this.view?.crystals ?? 0,
      ),
      activeBeaconName:
        this.view?.activeBeacon && this.view.activeBeacon.landmarkId !== id
          ? LANDMARKS.find((o) => o.id === this.view!.activeBeacon!.landmarkId)
              ?.name
          : undefined,
      rallied: v.rallied,
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
    if (!this.canShowObject(o)) return;
    this.closeJourney();
    this._landmark?.close();
    this._unistop?.close();
    this._chestModal?.close();
    this._carousel?.close();
    if (o.kind === "landmark") {
      const d = this.data(o.id);
      if (d) this.landmark.open(d);
    } else if (o.kind === "unistop" && o.tier && this.player) {
      const ownerId =
        o.ownerSchoolId ??
        (o.ownerSchoolSlot !== null && o.ownerSchoolSlot !== undefined
          ? SCHOOLS[o.ownerSchoolSlot]?.id
          : null);
      this.unistop.open({
        id: o.id,
        tier: o.tier,
        x: o.x,
        z: o.z,
        ownerSchoolId: ownerId,
        schoolId: SCHOOLS[this.player.slot]!.id,
        cooldownUntil: this.view?.cooldowns[o.id] ?? 0,
        profileReady: true,
        hasWeeklyRunningPoints: (this.view?.weeklyKm ?? 0) > 0,
        giftStock: this.view?.giftStock?.[o.tier] ?? 0,
      });
    } else if (o.kind === "chest" && o.tier && this.player) {
      const keysCount = Number(this.view?.keys[o.tier] ?? 0);
      const claimed =
        (
          this.view?.chests.find((c) => c.id === o.id) as
            | (WorldObject & { claimed?: boolean })
            | undefined
        )?.claimed ?? false;
      this.chestModal.open({
        id: o.id,
        tier: o.tier as "aspire" | "nitro" | "predator",
        x: o.x,
        z: o.z,
        keysCount,
        claimed,
        discovered: true,
        giftStock: this.view?.giftStock?.[o.tier] ?? 0,
        hasWeeklyRunningPoints: (this.view?.weeklyKm ?? 0) > 0,
      });
    }
  }
  async refresh(): Promise<void> {
    if (!this.player) return;
    const token = this.player.token,
      generation = this.generation;
    const request = ++this.refreshRequest;
    try {
      const r = await gameFetch("/api/game", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`Gameplay ${r.status}`);
      const view = (await r.json()) as GameView;
      if (generation !== this.generation || request !== this.refreshRequest)
        return;
      const changed = JSON.stringify(this.view) !== JSON.stringify(view);
      this.view = view;
      this.onView(view);
      this.onWallet();
      if (this.panel.open && changed) this.render();
      this.panel.querySelector(".journey-sync-status")?.remove();
      const id = this._landmark?.getCurrentLandmarkId();
      if (id && this.landmark.isVisible()) {
        const d = this.data(id);
        if (d) this.landmark.update(d);
      }
      const stopId = this._unistop?.getStopId();
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
            x: o.x,
            z: o.z,
            tier: o.tier,
            ownerSchoolId: ownerId,
            schoolId: SCHOOLS[this.player.slot]!.id,
            cooldownUntil: view.cooldowns[o.id] ?? 0,
            profileReady: true,
            hasWeeklyRunningPoints: view.weeklyKm > 0,
            giftStock: view.giftStock?.[o.tier] ?? 0,
          });
        }
      }
      this._chestModal?.updateAvailability(
        view.giftStock ?? { aspire: 0, nitro: 0, predator: 0 },
        view.weeklyKm > 0,
      );
      const unseen = [...view.events]
        .reverse()
        .filter((e) => !this.seen.has(e.id));
      for (const e of unseen) this.seen.add(e.id);
      for (const e of unseen.slice(-3))
        NotificationBanner.show({
          title: campaignDisplayText(e.title),
          body: campaignDisplayText(e.body),
        });
      sessionStorage.setItem(
        `events-${this.scope}-${token}`,
        JSON.stringify([...this.seen].slice(-200)),
      );
    } catch {
      if (
        generation === this.generation &&
        request === this.refreshRequest &&
        !this.panel.querySelector(".journey-sync-status")
      ) {
        const retry = document.createElement("button");
        retry.className = "journey-sync-status";
        retry.textContent = "Chưa cập nhật được hành trình · Thử lại";
        retry.onclick = () => void this.refresh();
        this.panel.querySelector(".gameplay-content")!.prepend(retry);
      }
    }
  }
  private loot(r: RewardOutcome): LootItem {
    return {
      id: `${r.kind}-${r.quantity}`,
      name:
        r.kind === "gift"
          ? "Quà hiện vật"
          : `${{ points: "Điểm Tri Thức", crystals: "Tinh Thể", key: "Chìa Khóa", treasure_map: "Bản Đồ Kho Báu" }[r.kind]} ×${r.quantity}`,
      type:
        r.kind === "crystals"
          ? "crystal"
          : r.kind === "gift"
            ? "real_gift"
            : r.kind,
      description:
        r.kind === "gift"
          ? "Quà hiện vật đã lưu trong hành trang của bạn."
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
    this._landmark?.setPending(true);
    try {
      const r = await gameFetch("/api/game", {
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

      if (receipt.status === "rejected") {
        notifyActionError(
          "Chưa thể thực hiện",
          campaignDisplayText(receipt.message),
        );
        await this.refresh();
        return;
      }

      if (receipt.reward) {
        this._unistop?.close();
        this._chestModal?.close();
        const o =
          this.objects.find((o) => o.id === c.target) ??
          this.view?.chests.find((o) => o.id === c.target);
        const rows =
          receipt.rewardTable ??
          effectiveRewardOutcomes(
            c.action === "open" ? "chest" : "unistop",
            o?.tier ?? "aspire",
            this.view?.giftStock?.[o?.tier ?? "aspire"] ?? 0,
            (this.view?.weeklyKm ?? 0) > 0,
          );
        const winner = {
            ...this.loot(receipt.reward),
            ...(receipt.giftName ? { name: receipt.giftName } : {}),
          },
          items = Array.from({ length: 30 }, (_, i) =>
            i === 24 ? winner : this.loot(rows[i % rows.length]!),
          );
        const giftCode =
          receipt.reward.kind === "gift"
            ? (receipt.giftCode ??
              `R2PL-GIFT-${c.key.substring(0, 6).toUpperCase()}`)
            : undefined;

        this.carousel.spin({
          title: o ? this.objectName(o) : "Phần thưởng",
          sourceType: c.action === "open" ? "chest" : "unistop",
          tier: o?.tier ?? "aspire",
          items,
          winningIndex: 24,
          winningItem: winner,
          discoveryCoords: receipt.discovery
            ? { x: receipt.discovery.x, z: receipt.discovery.z }
            : undefined,
          onViewTreasureMap: (coords) => this.focus(coords.x, coords.z),
          giftCode,
        });

        if (receipt.reward.kind === "gift") {
          notifyGameEvent("real_gift_viral", {
            student_name: this.player?.label ?? "Bạn",
            gift_name: receipt.giftName ?? "Quà Hiện Vật Predator",
            gift_code: giftCode ?? "",
          });
        } else if (receipt.reward.kind === "treasure_map") {
          notifyGameEvent(
            "map_found",
            {
              chest_tier: (o?.tier ?? "aspire").toUpperCase(),
              x: receipt.discovery?.x ?? 0,
              z: receipt.discovery?.z ?? 0,
            },
            () => {
              if (receipt.discovery)
                this.focus(receipt.discovery.x, receipt.discovery.z);
            },
          );
        } else if (receipt.reward.kind === "key") {
          notifyGameEvent("key_found", {
            chest_tier: (o?.tier ?? "aspire").toUpperCase(),
          });
        }

        if (c.action === "open" && c.target) {
          this.onChestOpened?.(c.target);
          notifyGameEvent(
            "chest_opened_big",
            {
              chest_tier: (o?.tier ?? "aspire").toUpperCase(),
              x: o?.x ?? 0,
              z: o?.z ?? 0,
              reward_text: winner.name,
            },
            () => {
              if (o) this.focus(o.x, o.z);
            },
          );
        }
      }

      if (c.action === "guess") {
        if (!receipt.nextAvailableAtMs) {
          notifyGameEvent("lm_guess_correct", {
            crystals: GAME_CONFIG.landmark.puzzleBonusCrystals,
            student_name: this.player?.label ?? "Bạn",
            landmark_name:
              this.objects.find((x) => x.id === c.target)?.name ?? "Địa danh",
          });
        } else {
          notifyActionError(
            "Giải đố chưa chính xác",
            "Cần chờ 10 phút trước khi thử lại.",
          );
        }
      } else if (c.action === "contribute") {
        notifyActionSuccess(
          "Đóng góp Tinh Thể",
          `Đã nạp ${receipt.contributed ?? c.amount ?? 1} Tinh Thể vào Đèn hiệu công trình!`,
          undefined,
          "landmark",
          "flame",
        );
      } else if (c.action === "upkeep") {
        notifyActionSuccess(
          "Duy trì Tri thức chung",
          "Đã gia hạn 24 giờ cho vùng Tri thức giao lưu!",
          undefined,
          "territory",
          "shield-check",
        );
      } else if (c.action === "consolidate") {
        notifyActionSuccess(
          "Góp Điểm giữ tri thức",
          "Đã góp 1 Điểm để gom cụm Tri thức vĩnh viễn!",
          undefined,
          "territory",
          "shield-check",
        );
      }

      if (receipt.discovery)
        this.focus(receipt.discovery.x, receipt.discovery.z);
      await this.refresh();
    } catch {
      if (generation === this.generation)
        notifyActionError(
          "Chưa nhận được xác nhận",
          "Thao tác được lưu để thử lại khi kết nối ổn định.",
        );
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this._landmark?.setPending(false);
        this._unistop?.finishRequest();
      }
    }
  }
  private render(): void {
    const restore = preserveSurface(this.panel);
    const content = this.panel.querySelector(".gameplay-content")!;
    const scroll = content.scrollTop;
    const expanded = new Set(
      Array.from(
        content.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ).map((details) => details.dataset.section),
    );
    content.replaceChildren();
    const hero = document.createElement("div");
    hero.className = "journey-hero";
    const kicker = document.createElement("small");
    kicker.textContent = "KHÁM PHÁ · TIẾP TẾ · THẮP ĐÈN HIỆU";
    const heading = document.createElement("h2");
    heading.textContent =
      this.view?.rally &&
      this.view.rally.target !== this.view.activeBeacon?.landmarkId
        ? "Cùng trường tiến về đèn hiệu"
        : "Mở đường cho hành trình mới";
    const intro = document.createElement("p");
    intro.textContent =
      "Mở ô chung cạnh với tri thức trường mình. Khám phá trạm và công trình trên đường đi.";
    hero.append(kicker, heading, intro);
    if (this.onFindExpansion) {
      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "Tìm ô tiếp theo";
      next.onclick = () => {
        this.closeJourney();
        this.onFindExpansion?.();
      };
      hero.append(next);
    }
    content.append(hero);
    if (!this.view) {
      const empty = document.createElement("p");
      empty.className = "journey-empty";
      empty.textContent = "Đang đồng bộ hành trình…";
      content.append(empty);
    }
    if (this.view?.activeBeacon) {
      const beacon = document.createElement("div");
      beacon.className = "journey-beacon";
      const label = document.createElement("small");
      label.textContent = "ĐÈN HIỆU ĐANG HOẠT ĐỘNG";
      const title = document.createElement("h3");
      title.textContent = this.view.activeBeacon.name;
      const description = document.createElement("p");
      description.textContent = this.view.activeBeacon.description;
      beacon.append(label, title, description);
      content.append(beacon);
    }
    const storage = this.player
      ? `pending-game-${this.scope}-${this.player.token}`
      : "";
    const pending = sessionStorage.getItem(storage);
    if (this.view?.rally) {
      const target = this.objects.find(
        (o) => o.id === this.view!.rally!.target,
      );
      const progress = this.view.landmarks.find((o) => o.id === target?.id);
      if (
        target &&
        progress &&
        this.view.activeBeacon?.landmarkId !== target.id
      ) {
        const rally = document.createElement("button");
        rally.className = "school-rally";
        rally.textContent = `Hiệu triệu: ${this.objectName(target)} · ${progress.pot}/${progress.target} Tinh thể`;
        rally.onclick = () => this.pick(target);
        content.append(rally);
        const meter = document.createElement("progress");
        meter.className = "journey-meter";
        meter.max = progress.target;
        meter.value = progress.pot;
        meter.setAttribute("aria-label", "Tiến trình quỹ hiệu triệu");
        content.append(meter);
      }
    }
    if (pending) {
      const retry = document.createElement("button");
      retry.textContent = "Gửi lại lệnh đang chờ";
      retry.onclick = () =>
        void this.command(JSON.parse(pending) as GameCommand);
      content.append(retry);
    }
    const inventory = document.createElement("p");
    inventory.textContent =
      "Bản Đồ Kho Báu: " +
      (this.view?.treasureMaps ?? "—") +
      " · Chìa Khóa Aspire/Nitro/Predator: " +
      (this.view ? Object.values(this.view.keys).join("/") : "—");
    if (this.devMode) content.append(inventory);
    const gifts = this.view?.gifts ?? [];
    if (gifts.length > 0) {
      const section = document.createElement("div");
      section.className = "gift-inventory-section";

      const heading = document.createElement("h3");
      heading.textContent = "Quà hiện vật";
      section.append(heading);

      for (const gift of gifts) {
        const card = document.createElement("div");
        card.className = "gift-card";
        const isRedeemed = !!gift.redeemedAt;
        const code = gift.giftCode || gift.id;
        card.innerHTML = `
          <strong>${gift.tier} · Quà hiện vật</strong>
          <span class="gift-state">${isRedeemed ? "Đã nhận" : "Chờ nhận quà"}</span>
          <code>${code}</code>
          <button type="button" class="copy-gift-btn">Sao chép mã</button>
          <p>${isRedeemed ? `Đã nhận tại sự kiện (${new Date(Number(gift.redeemedAt)).toLocaleString("vi-VN")})` : "Đưa mã này cho Ban tổ chức tại sự kiện để nhận quà."}</p>
        `;
        if (gift.giftName)
          card.querySelector("strong")!.textContent =
            `${gift.tier} · ${gift.giftName}`;
        const copyBtn = card.querySelector(
          ".copy-gift-btn",
        ) as HTMLButtonElement;
        copyBtn?.addEventListener("click", () => {
          if (navigator.clipboard) {
            void navigator.clipboard.writeText(code);
            NotificationBanner.show({
              title: "Quà hiện vật",
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
        ? "Đồng bộ thành tích chạy"
        : `Chạy giả lập 1 km · +${GAME_CONFIG.running.kmToPointsRate} Điểm`;
    running.onclick = () =>
      void this.command({
        action: "running",
        ...(this.view?.runningMode === "http" ? {} : { amount: 1000 }),
      });
    if (
      this.view?.runningMode !== "portal" &&
      (this.devMode || this.view?.runningMode === "http")
    )
      content.append(running);
    if (this.view?.runningMode === "portal") {
      const note = document.createElement("p");
      note.textContent =
        "Thành tích và Điểm chạy được đồng bộ từ web giải chạy. Tiêu Điểm trong game không làm giảm điểm BXH chạy.";
      content.append(note);
    }
    const km = document.createElement("p");
    km.textContent = `Tuần này: ${this.view?.weeklyKm ?? 0} km`;
    content.append(km);
    for (const cluster of this.view?.shared ?? []) {
      const box = document.createElement("div");
      box.className = "shared-journey";
      const text = document.createElement("p");
      text.textContent = `${cluster.pair.map((s) => SCHOOLS[s]!.shortName).join(" + ")} · ${cluster.tiles} ô · ${cluster.status === "shared" ? `Duy trì đến ${new Date(cluster.due).toLocaleString()}` : `Góp Điểm giữ tri thức ${cluster.contributed}/${cluster.required} · hết hạn ${new Date(Math.min(cluster.hardUntil, cluster.rollingUntil)).toLocaleString()}`}`;
      const pay = document.createElement("button");
      pay.textContent =
        cluster.status === "shared"
          ? `Duy trì tri thức ${GAME_CONFIG.knowledge.upkeepPoints} Điểm`
          : "Góp 1 Điểm giữ tri thức";
      pay.disabled =
        cluster.status === "shared"
          ? Date.now() < cluster.freeUntil
          : cluster.guest !== this.player?.slot;
      if (cluster.status === "shared" && pay.disabled)
        pay.textContent = `Miễn duy trì đến ${new Date(cluster.freeUntil).toLocaleString()}`;
      if (cluster.status !== "shared" && pay.disabled)
        pay.textContent = "Trường khách đang góp Điểm";
      pay.onclick = () =>
        void this.command({
          action: cluster.status === "shared" ? "upkeep" : "consolidate",
          target: cluster.id,
          amount: 1,
        });
      box.append(text, pay);
      content.append(box);
    }
    const destinations = document.createElement("details");
    destinations.dataset.section = "destinations";
    destinations.open = expanded.has("destinations");
    const destinationSummary = document.createElement("summary");
    destinationSummary.textContent = "Công trình & trạm tiếp tế";
    destinations.append(destinationSummary);
    for (const o of [
      ...this.objects.filter((o) => o.kind !== "hq"),
      ...(this.view?.chests ?? []),
    ]) {
      if (!this.canShowObject(o)) continue;
      const row = document.createElement("div"),
        focus = document.createElement("button"),
        open = document.createElement("button");
      row.className = "destination-row";
      focus.innerHTML = Icons.target(16);
      focus.setAttribute("aria-label", `Đi tới ${this.objectName(o)}`);
      focus.title = `Đi tới ${this.objectName(o)}`;
      focus.onclick = () => this.focus(o.x, o.z);
      open.textContent = this.devMode
        ? `${o.name} · (${o.x}, ${o.z})`
        : this.objectName(o);
      open.dataset.objectId = o.id;
      if (!this.devMode && o.kind === "landmark") {
        const landmark = this.view?.landmarks.find((l) => l.id === o.id);
        if (landmark?.holder === this.player?.slot)
          open.textContent += " · Đang thắp";
        else if (landmark?.hasPath) open.textContent += " · Có thể nạp";
      }
      open.onclick = () => this.pick(o);
      row.append(focus, open);
      destinations.append(row);
    }
    content.append(destinations);
    const history = document.createElement("details");
    history.dataset.section = "history";
    history.open = expanded.has("history");
    const summary = document.createElement("summary");
    summary.textContent = "Lịch sử & thông báo";
    history.append(summary);
    for (const event of this.view?.events ?? []) {
      const row = document.createElement("p");
      row.textContent = campaignDisplayText(`${event.title} · ${event.body}`);
      history.append(row);
    }
    content.append(history);
    if (!this.view?.events.length) {
      const empty = document.createElement("p");
      empty.className = "journey-empty";
      empty.textContent =
        "Những hoạt động mới của trường sẽ xuất hiện tại đây.";
      history.append(empty);
    }
    content.scrollTop = scroll;
    restore();
  }
}

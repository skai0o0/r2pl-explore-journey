import type { DevRewardTarget } from "../../shared/rewards/playable.ts";
import { RewardSession, type RewardState } from "./rewardSession.ts";
import { CarouselModal } from "./ui/carouselModal.ts";
import type { LootItem } from "./ui/v1Adapters.ts";

const element = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing reward UI: ${id}`);
  return node as T;
};
const rewardNames = {
  points: "test credits",
  crystals: "Crystals",
  treasure_map: "Treasure Map",
  key: "Key",
};
const reasons = {
  NOT_AVAILABLE: "Phần thưởng không còn khả dụng",
  COOLDOWN: "UniStop đang hồi",
  KEY_REQUIRED: "Cần 1 Key để mở Chest",
  POLICY_PENDING: "Đang chờ duyệt chính sách Gift",
};
export class RewardsPanel {
  readonly #dialog = element<HTMLDialogElement>("rewards-dialog");
  readonly #open = element<HTMLButtonElement>("inventory-button");
  readonly #session: RewardSession;
  readonly #carousel = new CarouselModal();
  #lastShownKey = "";
  #label = "";
  constructor(
    enabled: boolean,
    committed: (token: string) => void,
    scope = "",
  ) {
    this.#session = new RewardSession(
      sessionStorage,
      (state) => this.#render(state),
      committed,
      undefined,
      undefined,
      scope,
    );
    this.#open.hidden = !enabled;
    this.#open.addEventListener("click", () => {
      this.#dialog.showModal();
      void this.#session.refresh();
    });
    element("rewards-close").addEventListener("click", () =>
      this.#dialog.close(),
    );
    element("rewards-refresh").addEventListener(
      "click",
      () => void this.#session.refresh(),
    );
    element("rewards-retry").addEventListener(
      "click",
      () => void this.#session.retry(),
    );
    window.setInterval(() => {
      if (enabled && !document.hidden) void this.#session.refresh();
    }, 5000);
    window.setInterval(() => this.#countdowns(), 1000);
  }
  refresh(): void {
    void this.#session.refresh();
  }

  get open(): boolean {
    return this.#dialog.open;
  }
  select(token: string, label: string): void {
    if (this.#open.hidden) return;
    this.#label = label;
    element("reward-player").textContent = label;
    this.#session.select(token);
  }
  #render(state: RewardState): void {
    const inventory = state.inventory;
    for (const [field, id] of [
      ["credits", "inventory-credits"],
      ["crystals", "inventory-crystals"],
      ["treasureMaps", "inventory-maps"],
      ["keys", "inventory-keys"],
    ] as const)
      element(id).textContent = inventory?.[field] ?? "—";
    this.#open.textContent = `Kho & phần thưởng · Key ${inventory?.keys ?? "—"}`;
    element("reward-player").textContent = this.#label;
    element("reward-status").textContent = state.message;
    const retry = element<HTMLButtonElement>("rewards-retry");
    retry.hidden = !state.pending;
    retry.disabled = state.busy;
    element("reward-command").textContent = state.pending
      ? `Mã lệnh: ${state.pending.key}`
      : "";
    const receipt = state.receipt;
    if (
      receipt &&
      receipt.status === "applied" &&
      receipt.reward &&
      receipt.command.key !== this.#lastShownKey
    ) {
      this.#lastShownKey = receipt.command.key;
      const kind = receipt.reward.kind;
      const isChest = receipt.command.targetId.startsWith("chest");
      const winner: LootItem = {
        id: `${kind}-${receipt.reward.quantity}`,
        name: `${rewardNames[kind]} ×${receipt.reward.quantity}`,
        type: kind === "crystals" ? "crystal" : kind,
        description: "Phần thưởng nhận từ Kho & phần thưởng.",
        rarity: receipt.reward.quantity >= 4 ? "epic" : "common",
        amount: receipt.reward.quantity,
        weight: 1,
      };
      const items: LootItem[] = Array.from({ length: 30 }, (_, i) =>
        i === 24
          ? winner
          : { ...winner, id: `${winner.id}-${i}` },
      );
      this.#carousel.spin({
        title: isChest ? "RƯƠNG KHO BÁU" : "TRẠM TIẾP TẾ",
        sourceType: isChest ? "chest" : "unistop",
        tier: "aspire",
        items,
        winningIndex: 24,
        winningItem: winner,
      });
    }
    element("reward-receipt").textContent = receipt
      ? receipt.status === "applied" && receipt.reward
        ? `Đã nhận ${receipt.reward.quantity} ${rewardNames[receipt.reward.kind]} · ${receipt.command.targetId} · ${new Date(receipt.processedAtMs).toLocaleTimeString()}`
        : reasons[receipt.reason!]
      : "Chưa có phần thưởng của người chơi này.";
    const list = element("reward-targets");
    const focusedTarget =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset.rewardTarget
        : undefined;
    list.replaceChildren();
    for (const target of state.targets) {
      const card = document.createElement("article");
      card.className = "reward-card";
      const title = document.createElement("h3");
      title.textContent =
        target.kind === "chest"
          ? "Treasure Chest"
          : `UniStop · ${target.profile === "aspire" ? "Aspire" : target.profile === "nitro" ? "Nitro" : "Predator"}`;
      const description = document.createElement("p");
      description.textContent = target.policyPending
        ? "Gift chưa được duyệt; điểm này chưa mở."
        : target.kind === "chest"
          ? "Dùng 1 Key · nhận 2 test credits · một lần cho trường."
          : "Nhận một phần thưởng thử nghiệm · có thời gian hồi.";
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.rewardTarget = target.targetId;
      button.disabled =
        state.busy ||
        !!state.pending ||
        !inventory ||
        !target.available ||
        (target.kind === "chest" && inventory.keys === "0");
      button.textContent = this.#targetLabel(target, inventory?.keys);
      if (
        target.nextAvailableAtMs &&
        !target.available &&
        !target.policyPending
      )
        button.dataset.readyAt = String(target.nextAvailableAtMs);
      button.addEventListener("click", () => void this.#session.act(target));
      card.append(title, description, button);
      list.append(card);
      if (focusedTarget === target.targetId && !button.disabled) button.focus();
    }
  }
  #targetLabel(target: DevRewardTarget, keys?: string): string {
    if (target.policyPending) return "Chờ duyệt Gift";
    if (target.claimed) return "Chest đã được mở";
    if (target.nextAvailableAtMs && !target.available)
      return this.#remaining(target.nextAvailableAtMs);
    if (!target.available) return "Chưa khả dụng";
    if (target.kind === "chest" && keys === "0") return "Cần 1 Key";
    return target.kind === "chest" ? "Mở Chest · 1 Key" : "Nhận thưởng Aspire";
  }
  #remaining(time: number): string {
    const seconds = Math.max(0, Math.ceil((time - Date.now()) / 1000));
    return seconds
      ? `Hồi sau ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "Đang kiểm tra thời gian hồi…";
  }
  #countdowns(): void {
    for (const button of Array.from(
      this.#dialog.querySelectorAll<HTMLButtonElement>("[data-ready-at]"),
    ))
      button.textContent = this.#remaining(Number(button.dataset.readyAt));
  }
}

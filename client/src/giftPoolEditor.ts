import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import {
  GIFT_TIERS,
  type GiftPoolItem,
  type GiftPoolSnapshot,
} from "../../shared/gameplay/giftPool.ts";

export function mountGiftPoolEditor(
  root: HTMLElement,
  request: <T>(path: string, body?: unknown) => Promise<T>,
): void {
  root.innerHTML = `<p>Hết quà: 0% → x1 tinh thể. Quà vẫn xuất hiện trên vòng quay.</p><button type="button" data-refresh>Tải kho mới nhất</button><p data-totals></p><form><label>Tên quà<input name="name" required maxlength="${GAME_CONFIG.rewards.giftPool.maxNameLength}"></label><label>Hạng<select name="tier">${GIFT_TIERS.map((t) => `<option>${t}</option>`).join("")}</select></label><label>Số lượng còn lại<input name="remaining" type="number" min="0" max="${GAME_CONFIG.rewards.giftPool.maxRemainingPerItem}" value="0" required></label><button type="submit">Lưu quà</button><button type="button" data-new>Thêm món mới</button></form><p role="status" aria-live="polite"></p><div data-items></div>`;
  const form = root.querySelector("form")!;
  const name = form.elements.namedItem("name") as HTMLInputElement;
  const tier = form.elements.namedItem("tier") as HTMLSelectElement;
  const remaining = form.elements.namedItem("remaining") as HTMLInputElement;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  let snapshot: GiftPoolSnapshot | undefined,
    selected: string | undefined,
    editRevision = 0,
    busy = false,
    conflicted = false;
  function reset() {
    conflicted = false;
    selected = undefined;
    form.reset();
    tier.disabled = false;
  }
  function edit(item: GiftPoolItem) {
    conflicted = false;
    selected = item.id;
    editRevision = snapshot!.revision;
    name.value = item.name;
    tier.value = item.tier;
    tier.disabled = true;
    remaining.value = String(item.remaining);
    name.focus();
  }
  function render(next: GiftPoolSnapshot) {
    snapshot = next;
    root.querySelector("[data-totals]")!.textContent = GIFT_TIERS.map(
      (t) => `${t.toUpperCase()}: ${next.totals[t]}`,
    ).join(" · ");
    const list = root.querySelector("[data-items]")!;
    list.replaceChildren();
    if (!next.items.length) list.textContent = "Kho đang trống.";
    for (const item of next.items) {
      const row = document.createElement("article"),
        label = document.createElement("strong"),
        note = document.createElement("p"),
        change = document.createElement("button");
      row.className = "studio-pool-item";
      label.textContent = item.name;
      note.textContent = `${item.tier.toUpperCase()} · Còn ${item.remaining} · Đã trúng ${item.awarded}${item.active ? "" : " · Đã ngừng"}`;
      change.type = "button";
      change.textContent = item.active ? "Sửa / bổ sung" : "Sửa / mở lại";
      change.onclick = () => edit(item);
      row.append(label, note, change);
      if (item.active) {
        const archive = document.createElement("button");
        archive.type = "button";
        archive.textContent = "Ngừng phát";
        archive.onclick = () =>
          void run(async () => {
            render(
              await request<GiftPoolSnapshot>("/api/admin/gift-pool", {
                action: "archive",
                id: item.id,
                expectedRevision: snapshot!.revision,
              }),
            );
            if (selected === item.id) reset();
            status.textContent = "Đã ngừng phát món quà.";
          });
        row.append(archive);
      }
      list.append(row);
    }
  }
  async function load() {
    render(await request<GiftPoolSnapshot>("/api/admin/gift-pool"));
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await work();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Chưa thể kết nối.";
      if (message === "GIFT_POOL_CHANGED") {
        conflicted = true;
        try {
          await load();
        } catch {
          /* Keep the unsaved form available for retry. */
        }
        status.textContent =
          "Kho vừa thay đổi do lượt quay hoặc admin khác. Kiểm tra số lượng mới trước khi lưu lại.";
      } else status.textContent = message;
    } finally {
      busy = false;
    }
  }
  root.querySelector<HTMLButtonElement>("[data-refresh]")!.onclick = () =>
    void run(async () => {
      await load();
      status.textContent = "Đã tải kho. Nội dung đang nhập được giữ nguyên.";
    });
  root.querySelector<HTMLButtonElement>("[data-new]")!.onclick = reset;
  form.onsubmit = (event) => {
    event.preventDefault();
    void run(async () => {
      if (conflicted)
        throw new Error(
          "Chọn Sửa / bổ sung để dùng số lượng mới nhất trước khi lưu lại.",
        );
      if (!snapshot) throw new Error("Hãy tải kho trước khi lưu.");
      render(
        await request<GiftPoolSnapshot>("/api/admin/gift-pool", {
          action: "upsert",
          expectedRevision: selected ? editRevision : snapshot.revision,
          ...(selected ? { id: selected } : {}),
          name: name.value,
          tier: tier.value,
          remaining: remaining.valueAsNumber,
        }),
      );
      reset();
      status.textContent =
        "Đã lưu pool quà. Tỉ lệ áp dụng từ lượt quay tiếp theo.";
    });
  };
  const details = root.closest("details");
  details?.addEventListener("toggle", () => {
    if (details.open && !snapshot) void run(load);
  });
}

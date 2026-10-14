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
      '<summary>Admin Map Editor</summary><input type="password" aria-label="Admin key" placeholder="ADMIN_KEY"><button class="load">Mở editor</button><button class="rollback">Khôi phục layout trước</button><select aria-label="Object mới"><option value="unistop">UniStop</option><option value="chest">Chest</option></select><select aria-label="Tier mới"><option>aspire</option><option>nitro</option><option>predator</option></select><button class="place">Đặt object mới</button><input type="number" min="0" max="100000" aria-label="Gift stock staging" placeholder="Gift stock"><button class="stock">Cập nhật Gift stock staging</button><input aria-label="Tiêu đề thông báo" placeholder="Tiêu đề"><input aria-label="Nội dung thông báo" placeholder="Nội dung"><button class="notify">Gửi thông báo campaign</button>';
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
}

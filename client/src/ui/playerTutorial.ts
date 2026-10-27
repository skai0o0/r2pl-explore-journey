import { PLAYER_TUTORIAL } from "../../../shared/gameplay/gameConfig.ts";
import { UiOverlay } from "./overlay.ts";

export const isTutorialEligible = (count: number): boolean =>
  Number.isInteger(count) &&
  count >= 0 &&
  count < PLAYER_TUTORIAL.activityThreshold;

export const TUTORIAL_STEPS = [
  {
    title: "HQ của trường bạn",
    text: "Đây là HQ trường bạn — nơi bắt đầu hành trình khám phá.",
  },
  {
    title: "Mở ô tri thức",
    text: "Chạm ô sát vùng tri thức của trường, rồi chọn “Mở ô này”. Bật mở nhanh để mở ô chỉ với một chạm.",
  },
  {
    title: "Khám phá màn sương",
    text: "Bí ẩn và phần thưởng đang ẩn trong sương. Mở rộng khám phá để tìm thấy!",
  },
  {
    title: "Thắp sáng công trình",
    text: "Ưu tiên công trình gần bạn nhất: thắp sáng để nhận buff cho cả trường.",
  },
  {
    title: "Cùng trường tiến xa",
    text: "Mở rộng tri thức cho trường càng nhiều càng tốt. Chúc bạn chơi vui!",
  },
] as const;

export class PlayerTutorial {
  private root: HTMLElement | undefined;
  private surface: UiOverlay | undefined;
  private step = 0;
  private readonly options: {
    focus: (step: number) => void;
    oneTap: () => boolean;
    setOneTap: (enabled: boolean) => void;
    finish: () => void;
  };
  constructor(options: PlayerTutorial["options"]) {
    this.options = options;
  }
  start(): void {
    this.close();
    this.step = 0;
    const root = document.createElement("section");
    root.className = "player-tutorial";
    document.body.append(root);
    this.root = root;
    this.surface = new UiOverlay(
      root,
      () => this.dismiss(),
      "Hướng dẫn khám phá",
    );
    this.render();
    this.surface.open();
  }
  close(): void {
    this.surface?.close();
    this.surface = undefined;
    this.root?.remove();
    this.root = undefined;
    document.querySelectorAll(".tutorial-highlight").forEach((el) => {
      el.classList.remove("tutorial-highlight");
    });
  }
  private dismiss(): void {
    this.close();
    this.options.finish();
  }
  private render(): void {
    const root = this.root!;
    const step = TUTORIAL_STEPS[this.step]!;
    root.innerHTML =
      '<div class="tutorial-card"><div class="tutorial-top"><span class="tutorial-count"></span><button class="tutorial-skip" type="button">Bỏ qua</button></div><h2></h2><p class="tutorial-copy"></p><div class="tutorial-extra"></div><div class="tutorial-actions"><button class="tutorial-back" type="button">Quay lại</button><button class="tutorial-next" type="button" data-autofocus></button></div></div>';
    root.dataset.step = String(this.step);
    root.querySelector(".tutorial-count")!.textContent =
      `KHÁM PHÁ · ${this.step + 1}/${TUTORIAL_STEPS.length}`;
    root.querySelector("h2")!.textContent = step.title;
    root.querySelector(".tutorial-copy")!.textContent = step.text;
    const next = root.querySelector<HTMLButtonElement>(".tutorial-next")!;
    next.textContent =
      this.step === TUTORIAL_STEPS.length - 1
        ? "Bắt đầu khám phá"
        : "Tiếp theo →";
    next.onclick = () => {
      if (this.step === TUTORIAL_STEPS.length - 1) this.dismiss();
      else {
        this.step++;
        this.render();
        this.surface?.focus();
      }
    };
    const back = root.querySelector<HTMLButtonElement>(".tutorial-back")!;
    back.disabled = this.step === 0;
    back.onclick = () => {
      this.step--;
      this.render();
      this.surface?.focus();
    };
    root.querySelector<HTMLButtonElement>(".tutorial-skip")!.onclick = () =>
      this.dismiss();
    if (this.step === 1) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      label.className = "tutorial-one-tap";
      input.type = "checkbox";
      input.checked = this.options.oneTap();
      input.onchange = () => this.options.setOneTap(input.checked);
      label.append(input, "Mở nhanh một chạm");
      root.querySelector(".tutorial-extra")!.append(label);
    }
    document.querySelectorAll(".tutorial-highlight").forEach((el) => {
      el.classList.remove("tutorial-highlight");
    });
    this.options.focus(this.step);
  }
}

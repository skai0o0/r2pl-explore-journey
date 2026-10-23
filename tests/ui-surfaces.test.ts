import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  type HTMLButtonElement as TestButton,
  type HTMLElement as TestElement,
  Window,
} from "happy-dom";
import { CarouselModal } from "../client/src/ui/carouselModal.ts";
import { ChestModal } from "../client/src/ui/chestModal.ts";
import { isUiOverlayOpen, UiOverlay } from "../client/src/ui/overlay.ts";
import { UniStopModal } from "../client/src/ui/uniStopModal.ts";

test("exclusive surfaces isolate map input, trap focus and restore prior inert state", async () => {
  const w = new Window();
  Object.assign(globalThis, { window: w, document: w.document });
  const d = w.document;
  d.body.innerHTML =
    '<main><button id="hud-tools-toggle">Công cụ</button></main><aside inert></aside><section id="one"><button id="first">Đóng</button><details><summary>Chi tiết</summary><button id="hidden-action">Ẩn</button></details><button id="last">Tiếp</button></section><section id="two"><button>Đóng</button></section>';
  const one = d.getElementById("one")! as TestElement;
  const two = d.getElementById("two")! as TestElement;
  let firstCloses = 0,
    secondCloses = 0,
    mapEvents = 0;
  const first = new UiOverlay(
    one as unknown as HTMLElement,
    () => {
      firstCloses++;
      one.style.display = "none";
      first.close();
    },
    "Một",
  );
  const second = new UiOverlay(
    two as unknown as HTMLElement,
    () => {
      secondCloses++;
      two.style.display = "none";
      second.close();
    },
    "Hai",
  );
  try {
    (d.getElementById("hud-tools-toggle")! as TestElement).focus();
    first.open();
    assert.equal(d.querySelector("main")!.inert, true);
    assert.equal(d.activeElement?.id, "first");
    (d.getElementById("last")! as TestElement).focus();
    d.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    assert.equal(d.activeElement?.id, "first");
    d.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    assert.equal(d.activeElement?.id, "last");
    for (const name of ["pointerdown", "pointerup", "click", "wheel"]) {
      d.addEventListener(name, () => mapEvents++);
      one.dispatchEvent(new w.Event(name, { bubbles: true }));
    }
    assert.equal(mapEvents, 0);
    second.open();
    assert.equal(firstCloses, 1);
    assert.equal(one.style.display, "none");
    assert.equal(d.querySelector("main")!.inert, true);
    d.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(secondCloses, 1);
    assert.equal(isUiOverlayOpen(d as unknown as Document), false);
    assert.equal(d.querySelector("main")!.inert, false);
    assert.equal(d.querySelector("aside")!.inert, true);
    assert.equal(d.activeElement?.id, "hud-tools-toggle");
  } finally {
    first.close();
    second.close();
    await w.happyDOM.close();
  }
});

test("UniStop refresh preserves focus and scroll, displays rare odds, and yields to a chest", async () => {
  const w = new Window();
  Object.assign(globalThis, { window: w, document: w.document });
  w.document.body.innerHTML =
    '<main><button id="hud-tools-toggle">Công cụ</button></main>';
  const calls: string[] = [];
  const stop = new UniStopModal((id) => calls.push(id));
  const chest = new ChestModal({ onOpenChest: (id) => calls.push(id) });
  const view = {
    id: "test-nitro",
    tier: "nitro" as const,
    x: 10,
    z: 10,
    schoolId: "hcmut",
    ownerSchoolId: "hcmut",
    cooldownUntil: 0,
    profileReady: true,
    hasWeeklyRunningPoints: true,
    giftStock: 1,
  };
  try {
    stop.open(view);
    const button = w.document.querySelector<TestButton>(".unistop-claim")!;
    button.focus();
    const body = w.document.querySelector<TestElement>(".unistop-modal-body")!;
    body.scrollTop = 120;
    stop.update({ ...view });
    assert.equal(
      w.document.querySelector(".unistop-claim"),
      button,
      "unchanged cooldown refresh must retain the button node",
    );
    assert.equal(
      w.document.activeElement?.className,
      "guidance-primary unistop-claim",
    );
    assert.equal(
      w.document.querySelector(".unistop-modal-body")!.scrollTop,
      120,
    );
    assert.match(
      w.document.querySelector(".unistop-modal-overlay")!.textContent!,
      /0,1%/,
    );
    (
      w.document.querySelector(".unistop-claim")! as unknown as {
        click(): void;
      }
    ).click();
    (
      w.document.querySelector(".unistop-claim")! as unknown as {
        click(): void;
      }
    ).click();
    assert.deepEqual(calls, ["test-nitro"]);
    chest.open({
      id: "test-chest",
      tier: "nitro",
      x: 12,
      z: 12,
      keysCount: 0,
      claimed: false,
      discovered: true,
    });
    assert.equal(stop.isOpen(), false);
    assert.equal(chest.isVisible(), true);
    assert.match(
      w.document.querySelector(".chest-modal-overlay")!.textContent!,
      /7,5%/,
      "chest odds must preserve fractional weights",
    );
    w.document.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(chest.isVisible(), false);
    assert.equal(w.document.querySelector("main")!.inert, false);
    assert.deepEqual(calls, ["test-nitro"]);
  } finally {
    stop.close();
    chest.close();
    await w.happyDOM.close();
  }
});

test("cyan theme text pairs meet readable contrast on gameplay surfaces", async () => {
  const css = await readFile(
    new URL("../client/src/ui/theme.css", import.meta.url),
    "utf8",
  );
  const color = (name: string) => {
    const hex = css.match(new RegExp(`--${name}: #(\\w{6});`))![1]!;
    return [0, 2, 4]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  };
  for (const [text, background] of [
    ["text-primary", "surface"],
    ["muted", "surface"],
    ["cyan-bright", "surface"],
    ["ink", "cyan"],
  ]) {
    const a = color(text!),
      b = color(background!);
    assert(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
      `${text} on ${background}`,
    );
  }
});

test("a dialog nested inside the game shell also makes its HUD and canvas siblings inert", async () => {
  const w = new Window();
  Object.assign(globalThis, { window: w, document: w.document });
  w.document.body.innerHTML =
    '<main><header id="hud"><button>Hồ sơ</button></header><div id="world"><canvas></canvas></div><div id="scrim"><button>Đóng</button></div></main>';
  const root = w.document.getElementById("scrim")! as TestElement;
  const surface = new UiOverlay(
    root as unknown as HTMLElement,
    () => surface.close(),
    "Tiến trình",
  );
  try {
    surface.open();
    assert.equal(w.document.querySelector<TestElement>("#hud")!.inert, true);
    assert.equal(w.document.querySelector<TestElement>("#world")!.inert, true);
    assert.equal(root.inert, false);
    surface.close();
    assert.equal(w.document.querySelector<TestElement>("#hud")!.inert, false);
    assert.equal(w.document.querySelector<TestElement>("#world")!.inert, false);
  } finally {
    surface.close();
    await w.happyDOM.close();
  }
});

test("reduced motion shows the supplied receipt outcome and closing never replays a reward", async () => {
  const w = new Window();
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  });
  w.matchMedia = () => ({ matches: true }) as ReturnType<typeof w.matchMedia>;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  const modal = new CarouselModal();
  let claims = 0;
  try {
    const item = {
      id: "receipt-points",
      name: "Points ×2",
      type: "points" as const,
      rarity: "common" as const,
      quantity: 2,
      weight: 1,
      description: "Kết quả đã xác nhận",
    };
    modal.spin({
      title: "Tiếp tế",
      sourceType: "unistop",
      tier: "aspire",
      items: [item],
      winningIndex: 0,
      winningItem: item,
      onClaim: () => claims++,
    });
    assert.equal(
      w.document.querySelector<TestElement>(".carousel-result-overlay")!.inert,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(
      w.document.getElementById("cmodal-result-name")!.textContent,
      "Points ×2",
    );
    assert.equal(
      w.document.querySelector<TestElement>(".carousel-result-overlay")!.inert,
      false,
    );
    assert.equal(w.document.activeElement?.id, "cmodal-claim-btn");
    (w.document.getElementById("cmodal-claim-btn")! as TestButton).click();
    assert.equal(claims, 1);
    assert.equal(modal.isOpen(), false);
    modal.close();
    assert.equal(claims, 1);
  } finally {
    modal.close();
    await w.happyDOM.close();
  }
});

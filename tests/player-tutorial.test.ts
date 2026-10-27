import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  isTutorialEligible,
  PlayerTutorial,
} from "../client/src/ui/playerTutorial.ts";

test("tutorial eligibility stops at ten actions; five steps preserve one-tap preference and release the map", async () => {
  assert(isTutorialEligible(0));
  assert(isTutorialEligible(9));
  assert(!isTutorialEligible(10));
  assert(!isTutorialEligible(-1));
  assert(!isTutorialEligible(Number.NaN));
  const window = new Window(),
    old = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  window.document.body.innerHTML =
    '<main id="game"><button id="hud-tools-toggle">Tools</button></main>';
  const doc = window.document;
  let oneTap = false,
    finished = 0;
  const focus: number[] = [];
  const tutorial = new PlayerTutorial({
    focus: (step) => {
      focus.push(step);
    },
    oneTap: () => oneTap,
    setOneTap: (v) => {
      oneTap = v;
    },
    finish: () => {
      finished++;
    },
  });
  try {
    tutorial.start();
    assert(doc.querySelector<import("happy-dom").HTMLElement>("#game")!.inert);
    doc
      .querySelector<import("happy-dom").HTMLButtonElement>(".tutorial-next")!
      .click();
    const check = doc.querySelector<import("happy-dom").HTMLInputElement>(
      ".tutorial-one-tap input",
    )!;
    check.checked = true;
    check.dispatchEvent(new window.Event("change"));
    assert(oneTap);
    for (let i = 0; i < 4; i++)
      doc
        .querySelector<import("happy-dom").HTMLButtonElement>(".tutorial-next")!
        .click();
    assert.deepEqual(focus, [0, 1, 2, 3, 4]);
    assert.equal(finished, 1);
    assert.equal(doc.querySelector(".player-tutorial"), null);
    assert(!doc.querySelector<import("happy-dom").HTMLElement>("#game")!.inert);
    tutorial.start();
    doc
      .querySelector<import("happy-dom").HTMLButtonElement>(".tutorial-skip")!
      .click();
    assert.equal(finished, 2);
    tutorial.start();
    doc.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(finished, 3);
  } finally {
    tutorial.close();
    globalThis.document = old;
    await window.happyDOM.close();
  }
});

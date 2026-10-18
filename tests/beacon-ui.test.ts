import assert from "node:assert/strict";
import test from "node:test";
import { type HTMLButtonElement as TestButton, Window } from "happy-dom";
import {
  LandmarkModal,
  type LandmarkModalData,
} from "../client/src/ui/landmarkModal.ts";

test("landmark funding uses combined capacity without inventory or a separate conversion step", async () => {
  const w = new Window();
  Object.assign(globalThis, { window: w, document: w.document });
  const calls: { id: string; amount: number }[] = [],
    rallies: string[] = [];
  const modal = new LandmarkModal({
    onContributeCrystal: (id, amount) => calls.push({ id, amount }),
    onRally: (id) => rallies.push(id),
  });
  const data: LandmarkModalData = {
    landmarkId: "halong",
    landmarkKey: "halong",
    name: "Vịnh Hạ Long",
    category: "scenic",
    footprint: { width: 40, height: 40 },
    buffDescription: "Đặc quyền khi thắp",
    gameplayRole: "test",
    x: 575,
    y: 330,
    currentCrystals: 100,
    maxCrystals: 1100,
    litBySchoolId: "",
    buffActive: false,
    crystalsBySchool: { hcmut: 100 },
    userPoints: 1000,
    userCrystals: 0,
    contributionCapacity: 1000,
    playerSchoolId: "hcmut",
    hasPath: true,
    activeBeaconName: "Đỉnh Fansipan",
    nameGuessed: true,
  };
  try {
    modal.open(data);
    const fund = w.document.querySelector<TestButton>('[data-amount="1000"]')!;
    assert(
      fund && !fund.disabled,
      "zero personal crystals must not disable Point-backed funding",
    );
    fund.click();
    assert.deepEqual(calls, [{ id: "halong", amount: 1000 }]);
    modal.setPending(true);
    assert(fund.disabled);
    fund.click();
    assert.equal(
      calls.length,
      1,
      "an in-flight deposit cannot be clicked again",
    );
    modal.setPending(false);
    assert(!fund.disabled);
    (
      w.document.querySelector("#lm-rally") as unknown as { click(): void }
    ).click();
    assert.deepEqual(rallies, ["halong"]);
    assert.match(w.document.body.textContent, /\+100 TINH THỂ VÀO QUỸ/);
    assert.match(w.document.body.textContent, /quỹ tại công trình cũ tiêu tán/);
    assert(!/10% MỐC|5%|Tinh thể cá nhân/.test(w.document.body.textContent));
    modal.update({ ...data, hasPath: false });
    assert(
      w.document.querySelector<TestButton>('[data-amount="1000"]')!.disabled,
    );
    modal.update({ ...data, buffActive: true, litBySchoolId: "hcmut" });
    assert(
      w.document.querySelector<TestButton>('[data-amount="1000"]')!.disabled,
    );
  } finally {
    modal.close();
    await w.happyDOM.close();
  }
});

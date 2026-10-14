import assert from "node:assert/strict";
import test from "node:test";
import { selectedTileAction } from "../shared/gameplay/tileAction.ts";

test("selected tile actions protect HQs, require a shared edge and never expose rival masks", () => {
  for (const slot of [0, 7, 15]) {
    const own = 1 << slot;
    const rival = slot === 0 ? 2 : 1;
    assert.deepEqual(selectedTileAction(99, 0, slot, true, false), {
      tileIndex: 99,
      action: "explore",
      points: 1,
    });
    assert.deepEqual(selectedTileAction(99, rival, slot, true, false), {
      tileIndex: 99,
      action: "study",
      points: 2,
    });
    assert.equal(
      selectedTileAction(99, rival, slot, false, false).action,
      "blocked",
    );
    assert.equal(
      selectedTileAction(99, rival, slot, true, true).action,
      "blocked",
    );
    assert.equal(
      selectedTileAction(99, own | rival, slot, true, false).action,
      "owned",
    );
    const twoRivals = slot === 0 ? 6 : slot === 7 ? 3 : 3;
    assert.equal(
      selectedTileAction(99, twoRivals, slot, true, false).action,
      "blocked",
    );
  }
});

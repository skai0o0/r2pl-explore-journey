import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignDisplayText,
  footprintDiscovered,
  layoutMapLabels,
  objectDisplayName,
  uiModeFromSearch,
} from "../client/src/ui/playerPresentation.ts";
import {
  decodeExplore,
  decodeFrame,
  encodeExplore,
} from "../shared/protocol/m2.ts";
import { ProjectionReplica } from "../shared/protocol/replica.ts";

test("player mode is default and operator modes require explicit entry", () => {
  assert.equal(uiModeFromSearch(""), "player");
  assert.equal(uiModeFromSearch("?mode=normal&admin=0"), "player");
  assert.equal(uiModeFromSearch("?mode=dev"), "dev");
  assert.equal(uiModeFromSearch("?admin=1"), "admin");
});
test("player names hide fixture ordinals and unsolved Landmark names", () => {
  assert.equal(
    campaignDisplayText("Running: +10 Points · R2PL-GIFT-ABC123"),
    "Thành tích chạy: +10 Điểm · R2PL-GIFT-ABC123",
  );
  assert.equal(
    objectDisplayName({
      kind: "unistop",
      name: "UniStop - Aspire #8",
      tier: "aspire",
    }),
    "Trạm Aspire",
  );
  assert.equal(
    objectDisplayName({ kind: "hq", name: "HCMUT HQ" }),
    "Trụ sở HCMUT",
  );
  assert.equal(
    objectDisplayName({ kind: "landmark", name: "Đỉnh Fansipan" }, false),
    "Công trình bí ẩn",
  );
  assert.equal(
    objectDisplayName({ kind: "landmark", name: "Đỉnh Fansipan" }, true),
    "Đỉnh Fansipan",
  );
});
test("station labels obey footprint fog and label priority at close/overview zoom", () => {
  const replica = new ProjectionReplica(0),
    fog = new Uint8Array(512);
  fog[0] = 1;
  replica.applySnapshot({
    chunkId: 0,
    viewRevision: 0n,
    mask: new Uint8Array(8192),
    fog,
  });
  assert.equal(
    footprintDiscovered({ x: 1, z: 1, width: 2, height: 2 }, replica),
    true,
  );
  assert.equal(
    footprintDiscovered({ x: 40, z: 40, width: 2, height: 2 }, replica),
    false,
  );
  const make = (id: string, x: number) => ({
    id,
    x,
    y: 100,
    kind: "hq",
    ownHq: false,
    discovered: true,
    selected: false,
    hovered: false,
    width: 150,
    height: 25,
  });
  const labels = layoutMapLabels(
    [
      { ...make("mine", 100), ownHq: true },
      make("other", 105),
      { ...make("fog-stop", 300), kind: "unistop", discovered: false },
      make("offscreen", -20),
    ],
    80,
    { width: 800, height: 600 },
  );
  assert.equal(labels.get("mine"), "name");
  assert.equal(labels.get("other"), "hidden");
  assert.equal(labels.get("fog-stop"), "hidden");
  assert.equal(labels.get("offscreen"), "hidden");
  assert.equal(
    layoutMapLabels([make("far", 400)], 1000, { width: 800, height: 600 }).get(
      "far",
    ),
    "icon",
  );
  assert.equal(
    layoutMapLabels([{ ...make("selected", 400), selected: true }], 1000, {
      width: 800,
      height: 600,
    }).get("selected"),
    "name",
  );
});
test("manual intent survives transport while legacy auto payload stays compatible", () => {
  const base = { key: new Uint8Array(16), tileIndex: 63062, ruleVersion: 1 };
  assert.equal(
    decodeExplore(decodeFrame(encodeExplore(base)).payload).intent,
    undefined,
  );
  for (const intent of ["explore", "study"] as const)
    assert.equal(
      decodeExplore(decodeFrame(encodeExplore({ ...base, intent })).payload)
        .intent,
      intent,
    );
  assert.throws(() =>
    encodeExplore({ ...base, ruleVersion: 0, intent: "study" }),
  );
  assert.throws(() => decodeExplore(new Uint8Array(23)));
});

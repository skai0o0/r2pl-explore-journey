import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertApprovedSchoolSlotV1,
  fitsWorldFootprintV1,
  OWNER_FOOTPRINTS_V1,
  OWNER_LANDMARK_NAMES_V1,
  OWNER_UNIVERSITIES_V1,
} from "../shared/gameplay/ownerWorldCatalogV1.ts";
import {
  MAX_SCHOOL_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/world/constants.ts";

test("R4 school roster exactly eight Gamenote V2 approved codes in stable slot order", () => {
  assert.deepEqual(
    OWNER_UNIVERSITIES_V1.map((s) => s.code),
    ["HCMUT", "HCMCOU", "DTU", "DHHP", "HSU", "HUCE", "NTU", "HCMIU"],
  );
  assert.deepEqual(
    OWNER_UNIVERSITIES_V1.map((s) => s.slot),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(new Set(OWNER_UNIVERSITIES_V1.map((s) => s.name)).size, 8);
});
test("reserved school slots 8..15 cannot be assigned to an unapproved institution", () => {
  assert.equal(MAX_SCHOOL_SLOTS, 16);
  for (let slot = 0; slot < 8; slot++)
    assert.doesNotThrow(() => assertApprovedSchoolSlotV1(slot));
  for (let slot = 8; slot < 16; slot++)
    assert.throws(() => assertApprovedSchoolSlotV1(slot), RangeError);
  assert.throws(() => assertApprovedSchoolSlotV1(-1), RangeError);
});
test("approved footprint sizes replace historical values without inventing HQ locations", () => {
  assert.deepEqual(OWNER_FOOTPRINTS_V1, {
    HQ: { width: 30, height: 30 },
    UniStop: { width: 10, height: 2 },
    Chest: { width: 2, height: 2 },
    Landmark: { width: 40, height: 40 },
  });
  assert.equal("position" in OWNER_UNIVERSITIES_V1[0]!, false);
});
test("R4 10 approved Landmark names all originate from owner-selected catalog", () => {
  assert.deepEqual(OWNER_LANDMARK_NAMES_V1, [
    "Đỉnh Fansipan",
    "Vịnh Hạ Long",
    "Núi Ngũ Hành Sơn",
    "Động Phong Nha",
    "Núi Bà Đen",
    "Hoàng thành Thăng Long",
    "Cảng Hải Phòng",
    "Kinh thành Huế",
    "Tòa nhà Bitexco",
    "Chợ nổi Cái Răng",
  ]);
  assert.equal(new Set(OWNER_LANDMARK_NAMES_V1).size, 10);
});
test("world 1000x1000 footprint boundary is enforced for HQ and Landmark", () => {
  assert.equal(WORLD_WIDTH, 1000);
  assert.equal(WORLD_HEIGHT, 1000);
  assert.equal(fitsWorldFootprintV1("HQ", 970, 970), true);
  assert.equal(fitsWorldFootprintV1("HQ", 971, 970), false);
  assert.equal(fitsWorldFootprintV1("Landmark", 960, 960), true);
  assert.equal(fitsWorldFootprintV1("Landmark", 961, 960), false);
  assert.equal(fitsWorldFootprintV1("Landmark", 0, -1), false);
});
test("UniStop 10x2 and Chest 2x2 footprints fit only with sufficient room", () => {
  assert.equal(fitsWorldFootprintV1("UniStop", 990, 998), true);
  assert.equal(fitsWorldFootprintV1("UniStop", 991, 998), false);
  assert.equal(fitsWorldFootprintV1("Chest", 998, 998), true);
  assert.equal(fitsWorldFootprintV1("Chest", 999, 998), false);
  assert.throws(() => fitsWorldFootprintV1("HQ", 3.2, 0), RangeError);
  assert.throws(() => fitsWorldFootprintV1("Unknown" as "HQ", 0, 0), TypeError);
});

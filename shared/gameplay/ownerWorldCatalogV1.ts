/** Owner-approved world content catalog only. NOT placed on production map. */
import {
  MAX_SCHOOL_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/constants.ts";

export const OWNER_UNIVERSITIES_V1 = Object.freeze([
  { slot: 0, code: "HCMUT", name: "Trường Đại học Bách khoa – ĐHQG TP.HCM" },
  { slot: 1, code: "HCMCOU", name: "Trường Đại học Mở TP.HCM" },
  { slot: 2, code: "DTU", name: "Đại học Duy Tân" },
  { slot: 3, code: "DHHP", name: "Trường Đại học Hải Phòng" },
  { slot: 4, code: "HSU", name: "Trường Đại học Hoa Sen" },
  { slot: 5, code: "HUCE", name: "Đại học Xây dựng Hà Nội" },
  { slot: 6, code: "NTU", name: "Đại học Nha Trang" },
  { slot: 7, code: "HCMIU", name: "Đại học Quốc tế – ĐHQG TP.HCM" },
] as const);

export const OWNER_LANDMARK_NAMES_V1 = Object.freeze([
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
] as const);

/** Logical tiles. Sizes are owner-approved; coordinates and placement remain deferred. */
export const OWNER_FOOTPRINTS_V1 = Object.freeze({
  HQ: Object.freeze({ width: 30, height: 30 }),
  UniStop: Object.freeze({ width: 10, height: 2 }),
  Chest: Object.freeze({ width: 2, height: 2 }),
  Landmark: Object.freeze({ width: 40, height: 40 }),
});
export type OwnerObjectTypeV1 = keyof typeof OWNER_FOOTPRINTS_V1;

export function assertApprovedSchoolSlotV1(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SCHOOL_SLOTS)
    throw new RangeError("Invalid school slot");
  if (!OWNER_UNIVERSITIES_V1.some((school) => school.slot === slot)) {
    throw new RangeError(
      "Slot is reserved, not one of eight approved universities",
    );
  }
}

/** Checks a proposed footprint fits the logical world; it does not publish world design or check overlaps. */
export function fitsWorldFootprintV1(
  type: OwnerObjectTypeV1,
  x: number,
  z: number,
): boolean {
  if (!Object.hasOwn(OWNER_FOOTPRINTS_V1, type))
    throw new TypeError("Unknown object type");
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z))
    throw new RangeError("Coordinates must be integers");
  const size = OWNER_FOOTPRINTS_V1[type];
  return (
    x >= 0 &&
    z >= 0 &&
    x + size.width <= WORLD_WIDTH &&
    z + size.height <= WORLD_HEIGHT
  );
}

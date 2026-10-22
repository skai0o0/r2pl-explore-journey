import {
  GAME_CONFIG,
  LANDMARKS,
  SCHOOLS,
  type WorldObject,
} from "./gameConfig.ts";

export const EDITOR_CONFIG = GAME_CONFIG.editor;
export function placementError(
  object: WorldObject,
  objects: readonly WorldObject[],
): string | undefined {
  if (![object.x, object.z].every(Number.isInteger))
    return "Vị trí phải nằm trên lưới ô.";
  if (
    object.x - object.width / 2 < 0 ||
    object.z - object.height / 2 < 0 ||
    object.x + object.width / 2 > 1000 ||
    object.z + object.height / 2 > 1000
  )
    return "Vật thể nằm ngoài bản đồ.";
  if (
    objects.some(
      (o) =>
        o.id !== object.id &&
        Math.abs(o.x - object.x) < (o.width + object.width) / 2 &&
        Math.abs(o.z - object.z) < (o.height + object.height) / 2,
    )
  )
    return "Vị trí chồng lên vật thể khác.";
  return undefined;
}
export function validateEditorLayout(
  input: unknown,
): asserts input is WorldObject[] {
  if (
    !Array.isArray(input) ||
    input.length > EDITOR_CONFIG.maxObjects ||
    input.length < SCHOOLS.length + LANDMARKS.length
  )
    throw new TypeError("Số lượng vật thể không hợp lệ.");
  const ids = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new TypeError("Vật thể không hợp lệ.");
    const o = raw as WorldObject;
    if (
      typeof o.id !== "string" ||
      !/^[a-z0-9_-]{1,100}$/.test(o.id) ||
      ids.has(o.id) ||
      !["hq", "landmark", "unistop", "chest"].includes(o.kind) ||
      typeof o.name !== "string" ||
      !o.name.trim() ||
      o.name.length > 100 ||
      /[<>]/.test(o.name) ||
      [...o.name].some((char) => char.charCodeAt(0) < 32)
    )
      throw new TypeError("Tên hoặc mã vật thể không hợp lệ.");
    if (
      Object.keys(o).some(
        (k) =>
          ![
            "id",
            "kind",
            "name",
            "x",
            "z",
            "width",
            "height",
            "schoolSlot",
            "tier",
            "ownerSchoolSlot",
            "ownerSchoolId",
          ].includes(k),
      )
    )
      throw new TypeError("Thuộc tính vật thể không được hỗ trợ.");
    ids.add(o.id);
    const f = GAME_CONFIG.footprints[o.kind];
    if (o.width !== f.width || o.height !== f.height)
      throw new TypeError("Kích thước vật thể không hợp lệ.");
    if (
      o.kind === "hq" &&
      !SCHOOLS.some((s) => s.slot === o.schoolSlot && o.id === `hq-${s.id}`)
    )
      throw new TypeError("Trụ sở không thuộc trường thi đấu.");
    if (o.kind === "landmark") {
      const landmark = LANDMARKS.find((l) => l.id === o.id);
      if (!landmark) throw new TypeError("Công trình không hợp lệ.");
      (o as { name: string }).name = landmark.name;
    }
    if (
      ["unistop", "chest"].includes(o.kind) &&
      !["aspire", "nitro", "predator"].includes(o.tier ?? "")
    )
      throw new TypeError("Hạng vật thể không hợp lệ.");
    if (o.kind !== "hq" && o.schoolSlot !== undefined)
      throw new TypeError("Vật thể không được gán slot trường.");
  }
  if (
    input.filter((o) => o.kind === "hq").length !== SCHOOLS.length ||
    input.filter((o) => o.kind === "landmark").length !== LANDMARKS.length
  )
    throw new TypeError("Phải giữ đủ 8 trụ sở và 10 công trình.");
  for (const o of input) {
    const error = placementError(o, input);
    if (error) throw new RangeError(error);
  }
}

export interface EditorSnapshot {
  objects: WorldObject[];
  revision: number;
  draft: {
    objects: WorldObject[];
    revision: number;
    baseRevision: number;
  } | null;
  history: { revision: number; actor: string; createdAt: string }[];
}

import { ColyseusSDK, type Room } from "@colyseus/sdk";
import {
  edgeNeighbors,
  headquartersOwner,
  isExpansionEdge,
} from "../../shared/gameplay/expansion.ts";
import {
  FIRST_LANDMARK_BY_SLOT,
  GAME_CONFIG,
  LANDMARKS,
  objectAt,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import {
  ACK_STATUS,
  decodeAck,
  decodeDelta,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeResync,
  encodeSubscribe,
  M2_KIND,
  REASON,
} from "../../shared/protocol/m2.ts";
import { ProjectionReplica } from "../../shared/protocol/replica.ts";
import type { GameView } from "../../shared/gameplay/commands.ts";
import {
  chunkCoordinatesForId,
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
  tileIndex,
} from "../../shared/world/coordinates.ts";
import { GameplayUI } from "./gameplayUI.ts";
import { fetchModelManifest } from "./modelManifest.ts";
import { OperatorUI } from "./operatorUI.ts";
import { CompassCard } from "./ui/compassCard.ts";
import { FloatingTextManager } from "./ui/floatingText.ts";
import { MiniMap } from "./ui/miniMap.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
import {
  notifyActionError,
  notifyActionSuccess,
  notifyGameEvent,
} from "./ui/notifications.ts";
import {
  objectDisplayName,
  uiModeFromSearch,
} from "./ui/playerPresentation.ts";
import { StatsOverlay } from "./ui/statsOverlay.ts";
import { StudentActionDock } from "./ui/studentActionDock.ts";
import {
  deriveDevCreditState,
  type PickedTile,
  WorldView,
} from "./worldView.ts";
import "./style.css";

import {
  type DevPlayer,
  LEGACY_DEV_SESSION,
  parseDevSession,
} from "../../shared/integration/devSession.ts";

// Codex-owned transport bootstrap contract; existing presentation stays intact.
const bootstrapResponse = await fetch("/api/fixture/bootstrap", {
  cache: "no-store",
});
const session =
  bootstrapResponse.status === 404
    ? LEGACY_DEV_SESSION
    : parseDevSession(await bootstrapResponse.json());
if (bootstrapResponse.status !== 404 && !bootstrapResponse.ok)
  throw new Error("Synthetic session unavailable");
const publicWorld =
  session === LEGACY_DEV_SESSION
    ? []
    : (
        (await (await fetch("/api/fixture/world")).json()) as {
          objects: WorldObject[];
        }
      ).objects;
// Preload availability before WorldView synchronously chooses GLB or fallback.
await fetchModelManifest();
const miniMap = new MiniMap();
miniMap.setObjects(publicWorld);
const dock = new StudentActionDock();
const uiMode = uiModeFromSearch(location.search);
const isDev = uiMode === "dev";
document.body.dataset.mode = uiMode;
document.body.dataset.debug = String(isDev);
if (isDev) {
  const template = document.getElementById(
    "dev-tools-template",
  ) as HTMLTemplateElement;
  document
    .querySelector(".game-shell")!
    .append(template.content.cloneNode(true));
}
miniMap.element.append(document.querySelector(".map-tools")!);
const players = session.players;
type Player = DevPlayer;

interface Profile {
  name: string;
  schoolName: string;
  schoolSlot: number;
  balance: string;
  cost: string;
  fixtureOnly: true;
  inventory?: { crystals: string; keys: string };
}

interface PendingAction {
  key: string;
  frame: Uint8Array;
  tile: PickedTile;
  token: string;
}

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (
    !element &&
    [
      "school-name",
      "player-name",
      "balance",
      "explore-cost",
      "pending-count",
      "viewport-count",
      "activity-list",
      "player-select",
      "strip-hover",
    ].includes(id)
  )
    return document.createElement(
      id === "player-select"
        ? "select"
        : id === "activity-list"
          ? "ul"
          : "span",
    ) as T;
  if (!element) throw new Error(`Missing game UI element: ${id}`);
  return element as T;
};

const ui = {
  connection: get<HTMLElement>("connection-status"),
  school: get<HTMLElement>("school-name"),
  player: get<HTMLElement>("player-name"),
  balance: get<HTMLElement>("balance"),
  cost: get<HTMLElement>("explore-cost"),
  pending: get<HTMLElement>("pending-count"),
  viewport: get<HTMLElement>("viewport-count"),
  tile: get<HTMLElement>("tile-coordinates"),
  knowledge: get<HTMLElement>("tile-knowledge"),
  badge: get<HTMLElement>("tile-badge"),
  action: get<HTMLElement>("action-status"),
  activity: get<HTMLElement>("activity-list"),
  explore: get<HTMLButtonElement>("explore-button"),
  select: get<HTMLSelectElement>("player-select"),
  retry: get<HTMLButtonElement>("retry-button"),
  hover: get<HTMLElement>("strip-hover"),
};

const sdk = new ColyseusSDK(
  `ws://${location.hostname}:${session.websocketPort}`,
);
let player: Player =
  players.find(
    (item) => item.token === sessionStorage.getItem("r2pl-fixture-player"),
  ) ?? players[0]!;
let privateObjects: readonly WorldObject[] = [];
let replica = new ProjectionReplica(player.slot);
let room: Room | undefined;
let selected: PickedTile | undefined;
let generation = 0;
let subscribeTimer: number | undefined;
let balanceTimer: number | undefined;
let reconnectTimer: number | undefined;
let subscribed = "";
let profileBalance: string | undefined;
let profileCost: string | undefined;
let profileRequest = 0;
const pending = new Map<string, PendingAction>();
let nextStepTarget: { x: number; z: number } | undefined;
let latestView: GameView | undefined;

function lacksTestCredits(): boolean {
  return deriveDevCreditState(profileBalance, profileCost) === "insufficient";
}

function showInsufficientCredits(): void {
  ui.explore.disabled = true;
  ui.explore.textContent = "Chưa đủ Điểm Tri Thức";
}

function activity(message: string, kind = "normal"): void {
  const row = document.createElement("li");
  row.className = kind;
  row.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  ui.activity.prepend(row);
  while (ui.activity.children.length > 7) {
    ui.activity.lastElementChild?.remove();
  }
  ui.action.textContent = message;
  ui.action.dataset.kind = kind;
  if (kind === "error" || (kind === "success" && selected))
    NotificationBanner.show({
      title: kind === "error" ? "Chưa thể thực hiện" : "Hành trình khám phá",
      body: message,
    });
}

function status(label: string, online: boolean): void {
  ui.connection.textContent = label;
  ui.connection.dataset.online = String(online);
  ui.explore.disabled = !online || !selected || lacksTestCredits();
  ui.retry.hidden = online;
}

function keyHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function updatePending(): void {
  ui.pending.textContent = String(pending.size);
}

function expansionBlocked(tile: PickedTile): boolean {
  if (!session.adjacentOnly) return false;
  const owner = headquartersOwner(tile.index, session.headquarters ?? []);
  if (owner !== undefined && owner !== player.slot) return true;
  if (
    replica.hasChunk(tile.chunk) &&
    replica.maskAt(tile.chunk, tile.local) & (1 << player.slot)
  )
    return false;
  return !isExpansionEdge(tile.index, (neighbor) => {
    const { chunkX, chunkZ } = chunkCoordinatesForIndex(neighbor);
    const id = chunkId(chunkX, chunkZ);
    const { x, z } = tileCoordinates(neighbor);
    return (
      replica.hasChunk(id) &&
      !!(replica.maskAt(id, localIndex(x, z)) & (1 << player.slot))
    );
  });
}

function findShortestPathTo(
  targetX: number,
  targetZ: number,
): { x: number; z: number }[] | undefined {
  const isOwned = (x: number, z: number): boolean => {
    const chunk = chunkId(Math.floor(x / 64), Math.floor(z / 64));
    if (!replica.hasChunk(chunk)) return false;
    const local = (z % 64) * 64 + (x % 64);
    return !!(replica.maskAt(chunk, local) & (1 << player.slot));
  };

  if (isOwned(targetX, targetZ)) return undefined;

  const queue: [number, number][] = [[targetX, targetZ]];
  const parent = new Map<number, number>();
  const visited = new Set<number>([tileIndex(targetX, targetZ)]);

  const minX = Math.max(0, Math.min(targetX, player.home.x) - 40);
  const maxX = Math.min(999, Math.max(targetX, player.home.x) + 40);
  const minZ = Math.max(0, Math.min(targetZ, player.home.z) - 40);
  const maxZ = Math.min(999, Math.max(targetZ, player.home.z) + 40);

  let reachedOwned: [number, number] | undefined;

  while (queue.length > 0 && visited.size < 6000) {
    const [cx, cz] = queue.shift()!;
    if (isOwned(cx, cz)) {
      reachedOwned = [cx, cz];
      break;
    }

    const neighbors: readonly [number, number][] = [
      [cx + 1, cz],
      [cx - 1, cz],
      [cx, cz + 1],
      [cx, cz - 1],
    ];

    for (const [nx, nz] of neighbors) {
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
      const nIdx = tileIndex(nx, nz);
      if (visited.has(nIdx)) continue;
      visited.add(nIdx);
      parent.set(nIdx, tileIndex(cx, cz));
      queue.push([nx, nz]);
    }
  }

  if (!reachedOwned) return undefined;
  const [rx, rz] = reachedOwned;

  const path: { x: number; z: number }[] = [];
  let currIdx: number | undefined = parent.get(tileIndex(rx, rz));
  const targetIdx = tileIndex(targetX, targetZ);

  while (currIdx !== undefined) {
    const coords = tileCoordinates(currIdx);
    path.push(coords);
    if (currIdx === targetIdx) break;
    currIdx = parent.get(currIdx);
  }

  return path;
}

function refreshFrontierTiles(): void {
  if (!room || !replica) return;
  const frontiers: { x: number; z: number; isStudy?: boolean }[] = [];
  const visibleChunks = world.visibleChunkIds(selected?.chunk);
  const checked = new Set<number>();

  for (const cId of visibleChunks) {
    if (!replica.hasChunk(cId)) continue;
    const { chunkX, chunkZ } = chunkCoordinatesForId(cId);
    for (let local = 0; local < 4096; local++) {
      const mask = replica.maskAt(cId, local);
      if (!(mask & (1 << player.slot))) continue;
      const tx = chunkX * 64 + (local % 64);
      const tz = chunkZ * 64 + Math.floor(local / 64);
      const neighbors: readonly [number, number][] = [
        [tx + 1, tz],
        [tx - 1, tz],
        [tx, tz + 1],
        [tx, tz - 1],
      ];
      for (const [nx, nz] of neighbors) {
        if (nx < 0 || nx >= 1000 || nz < 0 || nz >= 1000) continue;
        const nIdx = tileIndex(nx, nz);
        if (checked.has(nIdx)) continue;
        checked.add(nIdx);
        const ncId = chunkId(Math.floor(nx / 64), Math.floor(nz / 64));
        if (!replica.hasChunk(ncId)) continue;
        const nLocal = (nz % 64) * 64 + (nx % 64);
        const nMask = replica.maskAt(ncId, nLocal);
        if (!(nMask & (1 << player.slot))) {
          const isStudy = nMask !== 0;
          frontiers.push({ x: nx, z: nz, isStudy });
        }
      }
    }
  }

  world.setFrontierTiles(frontiers);
}

function updateTile(): void {
  get("explore-button").closest<HTMLElement>(".tile-panel")!.hidden = !selected;
  if (!selected) return;
  const object = objectAt(selected.x, selected.z, [
    ...publicWorld,
    ...privateObjects,
  ]);
  const owned =
    replica.hasChunk(selected.chunk) &&
    !!(replica.maskAt(selected.chunk, selected.local) & (1 << player.slot));
  const discovered =
    replica.hasChunk(selected.chunk) &&
    replica.isDiscovered(selected.chunk, selected.local);
  ui.tile.textContent = object
    ? gameplay.objectName(object)
    : owned
      ? "Tri thức trường mình"
      : discovered
        ? "Vùng đã khám phá"
        : "Vùng sương mù";
  if (isDev) ui.tile.textContent += " · " + selected.x + ", " + selected.z;
  ui.action.textContent = "";
  ui.badge.textContent = owned
    ? "ĐÃ MỞ"
    : discovered
      ? "ĐÃ KHÁM PHÁ"
      : "CHƯA KHÁM PHÁ";
  ui.badge.className = "badge-tag " + (owned ? "owned" : "fogged");
  const waiting = [...pending.values()].some(
    (a) => a.tile.index === selected!.index,
  );
  if (waiting) {
    ui.knowledge.textContent = "Đang xác nhận thao tác của bạn…";
    ui.badge.textContent = "ĐANG XỬ LÝ";
    ui.explore.disabled = true;
    ui.explore.textContent = "Đang xử lý…";
    return;
  }
  if (object && object.kind !== "hq") {
    ui.knowledge.textContent =
      object.kind === "landmark"
        ? "Giải đố và góp Tinh Thể để thắp Đèn Hiệu."
        : object.kind === "chest"
          ? "Dùng Chìa Khóa cùng cấp để mở rương."
          : "Nhận tài nguyên khi trường bạn giữ trạm.";
    ui.explore.disabled = !gameplay.canShowObject(object);
    ui.explore.textContent =
      object.kind === "landmark"
        ? "Xem công trình"
        : object.kind === "chest"
          ? "Xem rương"
          : "Xem trạm tiếp tế";
    return;
  }
  if (owned) {
    world.setPathPreview(undefined);
    nextStepTarget = undefined;
    ui.knowledge.textContent =
      "Ô này đã thuộc tri thức của trường bạn. Không mất Điểm Tri Thức.";
    ui.explore.disabled = true;
    ui.explore.textContent = "Đã mở · 0 Điểm";
    return;
  }
  if (expansionBlocked(selected)) {
    const path = findShortestPathTo(selected.x, selected.z);
    if (path && path.length > 0) {
      world.setPathPreview(path);
      nextStepTarget = path[0];
      ui.knowledge.textContent = `Chưa chạm vùng Tri thức. Cần mở ${path.length} ô (~${path.length} Điểm) để tới đây.`;
      ui.explore.disabled = !room || lacksTestCredits();
      ui.explore.textContent = `⚡ Mở 1 ô tiến về mục tiêu (${path.length} ô)`;
    } else {
      world.setPathPreview(undefined);
      nextStepTarget = undefined;
      ui.knowledge.textContent =
        "Chọn ô chung cạnh với vùng tri thức của trường. Trụ sở trường khác được bảo vệ.";
      ui.explore.disabled = true;
      ui.explore.textContent = "Cần mở đường tới đây";
    }
    return;
  }
  world.setPathPreview(undefined);
  nextStepTarget = undefined;
  if (dock.getActiveMode() === "beacon" && !dock.isSmart()) {
    ui.knowledge.textContent = "Chọn một công trình để thắp Đèn Hiệu.";
    ui.explore.disabled = true;
    ui.explore.textContent = "Chọn công trình";
    return;
  }
  const study = !dock.isSmart() && dock.getActiveMode() === "study";
  const cost = study
    ? GAME_CONFIG.knowledge.sharedPoints
    : GAME_CONFIG.knowledge.explorePoints;
  ui.knowledge.textContent = dock.isSmart()
    ? "Tự chọn Khám Phá hoặc Giao Lưu theo ô bạn chạm."
    : study
      ? "Giao lưu ô có tri thức của một trường khác."
      : "Khám phá ô mới để mở rộng tri thức của trường.";
  ui.explore.disabled = !room;
  ui.explore.textContent = dock.isSmart()
    ? "Mở tri thức · 1–2 Điểm"
    : (study ? "Giao Lưu" : "Khám Phá") + " · " + cost + " Điểm";
  if (
    profileBalance !== undefined &&
    /^\d+$/.test(profileBalance) &&
    BigInt(profileBalance) < BigInt(cost)
  )
    showInsufficientCredits();
}

function updateHover(hovered?: PickedTile): void {
  if (!hovered) {
    ui.hover.textContent = "CURSOR: — / —";
  } else {
    const coords = `${hovered.x.toString().padStart(3, "0")} / ${hovered.z.toString().padStart(3, "0")}`;
    ui.hover.textContent = `CURSOR: ${coords}`;
  }
}

async function refreshProfile(token = player.token): Promise<void> {
  const attempt = generation;
  const request = ++profileRequest;
  try {
    const response = await fetch("/api/fixture/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Profile ${response.status}`);
    const profile = (await response.json()) as Profile;
    if (
      attempt !== generation ||
      request !== profileRequest ||
      token !== player.token ||
      profile.schoolSlot !== player.slot ||
      !profile.fixtureOnly
    )
      return;
    ui.school.textContent = profile.schoolName;
    ui.player.textContent = profile.name;
    ui.balance.textContent = profile.balance;
    ui.cost.textContent = profile.cost;
    profileBalance = profile.balance;
    profileCost = profile.cost;
    dock.setPoints(Number(profile.balance));
    stats.updateStats({
      studentName: profile.name,
      displayName:
        !isDev && /Explorer|explorer|connector|steward/.test(profile.name)
          ? `Chiến binh ${profile.schoolName}`
          : profile.name,
      schoolId: SCHOOLS[player.slot]?.id ?? "hcmut",
      schoolName: profile.schoolName,
      schoolColor: SCHOOLS[player.slot]?.color ?? "#fff",
      points: Number(profile.balance),
    });
    if (profile.inventory) {
      dock.setCrystals(Number(profile.inventory.crystals));
    }
    updateTile();
    document.body.dataset.school = player.slot === 0 ? "dawn" : "dusk";
    if (!welcomed.has(token) && profile.balance !== undefined) {
      welcomed.add(token);
      compass.welcome(profile.schoolName, profile.balance);
    }
  } catch {
    if (attempt === generation && token === player.token)
      activity("Chưa đồng bộ được số dư. Vui lòng thử lại.", "error");
  }
}

function refreshBalanceSoon(): void {
  window.clearTimeout(balanceTimer);
  balanceTimer = window.setTimeout(() => void refreshProfile(), 180);
}

const world = new WorldView(
  get("world-view"),
  (tile) => {
    if (operator?.relocating) {
      operator.relocate(tile.x, tile.z);
      return;
    }
    selected = tile;
    updateTile();
    const object = objectAt(tile.x, tile.z, [
      ...publicWorld,
      ...privateObjects,
    ]);
    world.setSelectedObject(object?.id);
    if (object && object.kind !== "hq" && gameplay.canShowObject(object))
      gameplay.pick(object);
    else if (dock.isSmart()) explore();
    else if (dock.getActiveMode() === "beacon")
      activity("Chọn một công trình để thắp Đèn Hiệu.");
  },
  () => {
    scheduleSubscribe();
    const camera = world.viewState;
    miniMap.updateCamera(camera.x, camera.z, camera.span);
    refreshFrontierTiles();
  },
  (hovered) => {
    updateHover(hovered);
    const object = hovered
      ? objectAt(hovered.x, hovered.z, [...publicWorld, ...privateObjects])
      : undefined;
    world.setHoveredObject(object?.id);
  },
  session.headquarters
    ? {
        markers: publicWorld.map((o) => ({
          id: o.id,
          color:
            o.schoolSlot === undefined
              ? "#eecb72"
              : SCHOOLS[o.schoolSlot]!.color,
          x: o.x,
          z: o.z,
          title: objectDisplayName(o, false),
          detail: "",
          schoolSlot: o.schoolSlot,
          kind: o.kind,
        })),
        placements: publicWorld
          .filter((o) => o.kind === "hq" || o.kind === "landmark")
          .map((o) => ({
            id: o.id,
            asset: o.kind as "hq" | "landmark",
            worldX: o.x,
            worldZ: o.z,
            scale: o.kind === "hq" ? 12 : 20,
            rotationZ: 0,
          })),
        objects: publicWorld,
        onPickObject: (obj) => {
          if (gameplay.canShowObject(obj) && obj.kind !== "hq") {
            gameplay.pick(obj);
          }
        },
      }
    : {
        onPickObject: (obj) => {
          if (gameplay.canShowObject(obj) && obj.kind !== "hq") {
            gameplay.pick(obj);
          }
        },
      },
);

const operator =
  uiMode !== "player"
    ? new OperatorUI(
        (x, z) => world.animateFocus(x, z, 100),
        (objects) => world.setEditorPreview(objects),
      )
    : undefined;
const stats = new StatsOverlay();
stats.onInventoryRequested = () => gameplay.openInventory();
const compass = new CompassCard(publicWorld, {
  nearestOwned: (target) => world.nearestOwned(target),
  focus: (x, z, span) => world.animateFocus(x, z, span),
});
if (isDev) Object.assign(window, { world, compass });
const welcomed = new Set<string>();
/** First Landmark on this school's stepping-stone path (falls back to the map centre). */
function homeLandmark(): { x: number; z: number; id: string } {
  const id = FIRST_LANDMARK_BY_SLOT[player.slot] ?? "fansipan";
  const o = publicWorld.find((w) => w.id === id) ??
    LANDMARKS.find((l) => l.id === id) ?? { x: 500, z: 500 };
  return { x: o.x, z: o.z, id };
}
stats.onFlyToHQRequested = () =>
  world.animateFocus(player.home.x, player.home.z, 100);
function refreshRanking(): void {
  void fetch("/api/game/ranking")
    .then((r) => r.json())
    .then((page: { rankings: { schoolId: string; points: number }[] }) =>
      stats.updateSchoolRankings(page.rankings),
    )
    .catch(() => {});
}
refreshRanking();
window.setInterval(refreshRanking, 5000);
const layoutDigest = JSON.stringify(publicWorld.map((o) => o.id));
window.setInterval(() => {
  void fetch("/api/fixture/world", { cache: "no-store" })
    .then((r) => r.json())
    .then((v: { objects: WorldObject[] }) => {
      let changed = false;
      for (const obj of v.objects) {
        const found = publicWorld.find((p) => p.id === obj.id);
        if (found) {
          if (
            found.ownerSchoolSlot !== obj.ownerSchoolSlot ||
            found.ownerSchoolId !== obj.ownerSchoolId
          ) {
            (
              found as { ownerSchoolSlot?: number | null | undefined }
            ).ownerSchoolSlot = obj.ownerSchoolSlot;
            (
              found as { ownerSchoolId?: string | null | undefined }
            ).ownerSchoolId = obj.ownerSchoolId;
            changed = true;
          }
        }
      }
      if (changed) {
        miniMap.setObjects([...publicWorld, ...privateObjects]);
        world.updateObjects(publicWorld);
      }
      if (
        JSON.stringify(v.objects.map((o) => o.id)) !== layoutDigest &&
        !document.querySelector(".layout-update")
      ) {
        const update = document.createElement("button");
        update.className = "layout-update";
        update.textContent = "Bản đồ có thay đổi · Làm mới";
        update.onclick = () => location.reload();
        document.body.append(update);
      }
    })
    .catch(() => {});
}, 5000);
const gameplay = new GameplayUI(
  publicWorld,
  (x, z) => world.focus(x, z, 100),
  (view) => {
    latestView = view;
    world.setBeacons(view.landmarks);
    compass.setSolvedLandmarks(
      view.landmarks.filter((l) => l.solved).map((l) => l.id),
    );
    const sharedTiles = new Map<number, readonly number[]>();
    for (const cluster of view.shared)
      for (const tile of cluster.tileIndexes ?? [])
        sharedTiles.set(tile, cluster.pair);
    world.setSharedTiles(sharedTiles);
    compass.refreshSoon();
    stats.updateExploration(
      view.revealedTiles,
      (view.revealedTiles /
        (GAME_CONFIG.world.width * GAME_CONFIG.world.height)) *
        100,
    );
    dock.setCrystals(Number(view.crystals));
    stats.updateStats({
      crystals: Number(view.crystals),
      aspireKeys: Number(view.keys.aspire),
      nitroKeys: Number(view.keys.nitro),
      predatorKeys: Number(view.keys.predator),
      litLandmarksCount: view.landmarks.filter((l) => l.holder === player.slot)
        .length,
      buffs: view.landmarks
        .filter((l) => l.holder === player.slot)
        .flatMap((v) => {
          const l = LANDMARKS.find((l) => l.id === v.id);
          return l ? [{ name: l.name, description: l.buffDescription }] : [];
        }),
    });
    dock.setKeys(
      Number(view.keys.aspire),
      Number(view.keys.nitro),
      Number(view.keys.predator),
    );
    privateObjects = view.chests;
    world.setPrivateObjects(view.chests);
    miniMap.setObjects([...publicWorld, ...view.chests]);
  },
  () => void refreshProfile(),
  session.campaignId ?? "",
  (id) => world.setChestOpen(id, true),
  isDev,
  (object) => object.kind !== "unistop" || world.isObjectDiscovered(object),
  (targetX, targetZ) => {
    world.animateFocus(targetX, targetZ, 120);
    const path = findShortestPathTo(targetX, targetZ);
    if (path && path.length > 0) {
      world.setPathPreview(path);
      const frontier = path[0]!;
      const tile: PickedTile = {
        x: frontier.x,
        z: frontier.z,
        index: tileIndex(frontier.x, frontier.z),
        chunk: chunkId(Math.floor(frontier.x / 64), Math.floor(frontier.z / 64)),
        local: (frontier.z % 64) * 64 + (frontier.x % 64),
      };
      selected = tile;
      world.select(tile);
      updateTile();
      activity(`Đã dẫn đường tới mục tiêu: Cần mở ${path.length} ô.`, "normal");
    }
  },
  () => {
    void gameplay.command({
      action: "running",
      ...(latestView?.runningMode === "http" ? {} : { amount: 1000 }),
    });
  },
);
miniMap.onPanRequested = (x, z) => world.animateFocus(x, z, 100);
miniMap.onPanLive = (x, z) => world.focus(x, z, 100);
miniMap.onZoomIn = () => world.zoom(0.72);
miniMap.onZoomOut = () => world.zoom(1.38);
miniMap.onRecenter = () =>
  world.animateFocus(player.home.x, player.home.z, 100);
dock.onToggleSmart = () => updateTile();
dock.onModeChange(() => {
  if (selected) updateTile();
});
dock.onBeaconAction = () => {
  const l = objectAt(selected?.x ?? 500, selected?.z ?? 500, publicWorld);
  if (l?.kind === "landmark") gameplay.pick(l);
  else {
    const first = homeLandmark();
    world.animateFocus(first.x, first.z, 200);
    const o = publicWorld.find((o) => o.id === first.id);
    if (o) gameplay.pick(o);
  }
};
const overviewButton = get<HTMLButtonElement>("overview-button");
const worldHost = get<HTMLElement>("world-view");

function announceCameraMode(log: boolean): void {
  const label =
    world.cameraMode === "isometric" ? "Góc nhìn 3D" : "Góc nhìn từ trên";
  overviewButton.title = "Toàn bản đồ (O)";
  get("camera-button").setAttribute("aria-label", `Đổi góc nhìn · ${label}`);
  worldHost.setAttribute(
    "aria-label",
    `Bản đồ Hành trình Khám phá. ${label}. Nhấn I để đổi góc nhìn.`,
  );
  if (log && isDev) activity(`${label} · nhấn I để đổi góc nhìn`);
}

announceCameraMode(true);

function scheduleSubscribe(): void {
  window.clearTimeout(subscribeTimer);
  subscribeTimer = window.setTimeout(subscribeNow, 300);
}

function subscribeNow(): void {
  if (!room) return;
  const neighborChunks =
    selected && session.adjacentOnly
      ? edgeNeighbors(selected.index).map((tile) => {
          const { chunkX, chunkZ } = chunkCoordinatesForIndex(tile);
          return chunkId(chunkX, chunkZ);
        })
      : [];
  const ids = [
    ...new Set([
      ...(selected ? [selected.chunk] : []),
      ...neighborChunks,
      ...world.visibleChunkIds(selected?.chunk),
    ]),
  ].slice(0, 64);
  const signature = ids.join(",");
  if (signature === subscribed) return;
  subscribed = signature;
  ui.viewport.textContent = String(ids.length);
  room.sendBytes("m2", encodeSubscribe(ids));
}

function explore(): void {
  const object = selected
    ? objectAt(selected.x, selected.z, [...publicWorld, ...privateObjects])
    : undefined;
  if (object && object.kind !== "hq") {
    if (gameplay.canShowObject(object)) gameplay.pick(object);
    return;
  }
  if (!dock.isSmart() && dock.getActiveMode() === "beacon") return;
  if (!room || !selected) {
    activity("Chọn một ô khi đã kết nối.", "error");
    return;
  }

  const actTile: PickedTile = nextStepTarget
    ? {
        x: nextStepTarget.x,
        z: nextStepTarget.z,
        index: tileIndex(nextStepTarget.x, nextStepTarget.z),
        chunk: chunkId(
          Math.floor(nextStepTarget.x / 64),
          Math.floor(nextStepTarget.z / 64),
        ),
        local: (nextStepTarget.z % 64) * 64 + (nextStepTarget.x % 64),
      }
    : selected;

  if (expansionBlocked(actTile)) {
    updateTile();
    scheduleSubscribe();
    activity(
      "Ô này chưa nằm sát vùng tri thức của trường hoặc thuộc HQ trường khác.",
      "normal",
    );
    return;
  }
  const required =
    !dock.isSmart() && dock.getActiveMode() === "study"
      ? GAME_CONFIG.knowledge.sharedPoints
      : GAME_CONFIG.knowledge.explorePoints;
  if (
    profileBalance !== undefined &&
    /^\d+$/.test(profileBalance) &&
    BigInt(profileBalance) < BigInt(required)
  ) {
    showInsufficientCredits();
    activity("Chưa đủ Điểm Tri Thức để mở ô.", "normal");
    return;
  }
  const key = crypto.getRandomValues(new Uint8Array(16));
  const action: PendingAction = {
    key: keyHex(key),
    frame: encodeExplore({
      key,
      tileIndex: actTile.index,
      ruleVersion: session === LEGACY_DEV_SESSION ? 0 : GAME_CONFIG.ruleVersion,
      ...(session === LEGACY_DEV_SESSION || dock.isSmart()
        ? {}
        : {
            intent:
              dock.getActiveMode() === "study"
                ? ("study" as const)
                : ("explore" as const),
          }),
    }),
    tile: actTile,
    token: player.token,
  };
  pending.set(action.key, action);
  world.setPending(actTile);
  updatePending();
  updateTile();
  activity("Đang mở tri thức…", "pending");
  room.sendBytes("m2", action.frame);
}

function handleFrame(raw: Uint8Array): void {
  try {
    const frame = decodeFrame(raw);
    switch (frame.kind) {
      case M2_KIND.ACK: {
        const ack = decodeAck(frame.payload);
        const action = pending.get(keyHex(ack.key));
        if (!action) break;
        pending.delete(action.key);
        world.setPending(Array.from(pending.values()).at(-1)?.tile);
        updatePending();
        if (ack.status === ACK_STATUS.TEST_APPLIED) {
          activity("Đã mở tri thức cho trường bạn.", "success");
          world.playReveal(action.tile.x, action.tile.z, player.slot);
          const screenPos = world.projectToScreen(
            action.tile.x,
            action.tile.z,
          );
          if (screenPos) {
            FloatingTextManager.spawn(
              screenPos.x,
              screenPos.y - 12,
              "-1 Point",
              "cost",
            );
            setTimeout(() => {
              FloatingTextManager.spawn(
                screenPos.x,
                screenPos.y - 32,
                "+1 Ô Tri Thức",
                "knowledge",
              );
            }, 100);
          }
          if (session !== LEGACY_DEV_SESSION) {
            const fogChunks = new Set<number>();
            for (
              let dz = -GAME_CONFIG.world.fogRevealRadius;
              dz <= GAME_CONFIG.world.fogRevealRadius;
              dz++
            )
              for (
                let dx = -GAME_CONFIG.world.fogRevealRadius;
                dx <= GAME_CONFIG.world.fogRevealRadius;
                dx++
              ) {
                const x = action.tile.x + dx,
                  z = action.tile.z + dz;
                if (x >= 0 && z >= 0 && x < 1000 && z < 1000)
                  fogChunks.add(
                    chunkId(Math.floor(x / 64), Math.floor(z / 64)),
                  );
              }
            for (const id of fogChunks) room?.sendBytes("m2", encodeResync(id));
          }
        } else if (ack.status === ACK_STATUS.TEST_NO_CHANGE) {
          activity(
            "Ô này đã có tri thức của trường bạn · không mất Điểm.",
            "normal",
          );
          const screenPos = world.projectToScreen(
            action.tile.x,
            action.tile.z,
          );
          if (screenPos) {
            FloatingTextManager.spawn(
              screenPos.x,
              screenPos.y - 12,
              "Đã có tri thức",
              "gain",
            );
          }
        } else {
          const screenPos = world.projectToScreen(
            action.tile.x,
            action.tile.z,
          );
          if (screenPos) {
            FloatingTextManager.spawn(
              screenPos.x,
              screenPos.y - 12,
              "Bị từ chối",
              "error",
            );
          }
          const errDetail =
            ack.reason === REASON.WRONG_ACTION
              ? "Ô này không phù hợp với thao tác đã chọn. Hãy chuyển sang Tự Động hoặc đổi Khám Phá/Giao Lưu."
              : "Ô này chưa chung cạnh biên giới hoặc bạn chưa đủ Điểm Tri Thức.";
          activity(errDetail, "error");
          notifyActionError("Chưa thể mở ô này", errDetail);
          world.playReject(action.tile.x, action.tile.z);
        }
        updateTile();
        refreshBalanceSoon();
        break;
      }
      case M2_KIND.SNAPSHOT: {
        const snapshot = decodeSnapshot(frame.payload);
        replica.applySnapshot(snapshot);
        world.paintChunk(snapshot.chunkId, replica);
        compass.refreshSoon();
        miniMap.paintProjection(snapshot.chunkId, replica);
        refreshFrontierTiles();
        updateTile();
        break;
      }
      case M2_KIND.DELTA: {
        const delta = decodeDelta(frame.payload);
        const result = replica.applyDelta(delta);
        if (result === "resync") {
          room?.sendBytes("m2", encodeResync(delta.chunkId));
        } else if (result === "applied") {
          world.paintTile(delta.chunkId, delta.localIndex, replica);
          compass.refreshSoon();
          miniMap.paintProjection(delta.chunkId, replica);
          refreshFrontierTiles();
          updateTile();
          refreshBalanceSoon();
        }
        break;
      }
      case M2_KIND.ERROR:
        activity("Chưa thể thực hiện thao tác. Vui lòng thử lại.", "error");
        break;
    }
  } catch (error) {
    activity("Đang đồng bộ lại bản đồ…", "error");
    for (const id of world.visibleChunkIds(selected?.chunk))
      room?.sendBytes("m2", encodeResync(id));
  }
}

async function connect(nextPlayer: Player): Promise<void> {
  const attempt = ++generation;
  window.clearTimeout(reconnectTimer);
  if (player.token !== nextPlayer.token) {
    ui.activity.replaceChildren();
    ui.action.textContent = "Đang chuyển tài khoản…";
    pending.clear();
    world.setPending(undefined);
    updatePending();
  }
  const previous = room;
  room = undefined;
  subscribed = "";
  if (previous) void previous.leave();
  player = nextPlayer;
  privateObjects = [];
  world.setPrivateObjects([]);
  miniMap.setObjects(publicWorld);
  gameplay.select(player);
  ui.balance.textContent = "—";
  ui.player.textContent = player.label;
  ui.school.textContent = player.schoolName;
  profileBalance = undefined;
  profileCost = undefined;
  sessionStorage.setItem("r2pl-fixture-player", player.token);
  replica = new ProjectionReplica(player.slot);
  selected = undefined;
  world.setSchool(player.slot);
  compass.setSchool(player.slot);
  miniMap.setSchool(player.slot);
  miniMap.setPlayerHQ(
    SCHOOLS[player.slot]?.id ?? "",
    player.home.x,
    player.home.z,
  );
  world.focus(
    player.home.x,
    player.home.z,
    session === LEGACY_DEV_SESSION ? 275 : 72,
  );
  updateTile();
  status("Đang kết nối…", false);
  void refreshProfile();
  try {
    const joined = await sdk.joinOrCreate("m2", { token: player.token });
    if (attempt !== generation) {
      void joined.leave();
      return;
    }
    room = joined;
    joined.onMessage("m2", (bytes: Uint8Array) => {
      if (attempt === generation) handleFrame(bytes);
    });
    joined.onLeave(() => {
      if (attempt !== generation) return;
      room = undefined;
      subscribed = "";
      status("Đang kết nối lại…", false);
      reconnectTimer = window.setTimeout(() => void connect(player), 1200);
    });
    status("Trực tuyến", true);
    activity(`Sẵn sàng khám phá cùng ${player.schoolName}.`, "success");
    subscribeNow();
    for (const action of pending.values()) {
      if (action.token === player.token) joined.sendBytes("m2", action.frame);
    }
  } catch {
    if (attempt !== generation) return;
    status("Chưa thể kết nối", false);
    activity("Chưa thể vào bản đồ. Bấm Kết nối lại để thử.", "error");
  }
}

for (const option of players) {
  ui.select.add(new Option(option.label, option.token));
}
ui.select.value = player.token;
ui.select.addEventListener("change", () => {
  const next = players.find((item) => item.token === ui.select.value);
  if (next) void connect(next);
});

ui.explore.addEventListener("click", explore);
ui.retry.addEventListener("click", () => void connect(player));

get("landmark-button").addEventListener("click", () => {
  const first = homeLandmark();
  world.animateFocus(first.x, first.z, 200);
});
overviewButton.addEventListener("click", () =>
  world.animateFocus(500, 500, 1000),
);
get("camera-button").addEventListener("click", () => {
  world.toggleCameraMode();
  announceCameraMode(false);
});
get("tile-close").addEventListener("click", () => {
  selected = undefined;
  world.setSelectedObject(undefined);
  updateTile();
});

window.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey &&
    event.altKey &&
    ["d", "a"].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    const url = new URL(location.href);
    url.searchParams.delete("mode");
    url.searchParams.delete("admin");
    if (uiMode === "player") {
      if (event.key.toLowerCase() === "d") url.searchParams.set("mode", "dev");
      else url.searchParams.set("admin", "1");
    }
    location.assign(url.toString());
    return;
  }
  if (
    gameplay.open ||
    event.target instanceof HTMLButtonElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLInputElement
  )
    return;
  switch (event.key) {
    case "h":
    case "H":
      world.animateFocus(player.home.x, player.home.z, 200);
      break;
    case "l":
    case "L": {
      const first = homeLandmark();
      world.animateFocus(first.x, first.z, 200);
      break;
    }
    case "o":
    case "O":
      world.animateFocus(500, 500, 1000);
      break;
    case "i":
    case "I":
      world.toggleCameraMode();
      announceCameraMode(true);
      break;
    case "+":
    case "=":
      world.zoom(0.72);
      break;
    case "-":
    case "_":
      world.zoom(1.38);
      break;
    case "Enter":
      if (selected && !ui.explore.disabled) explore();
      break;
  }
});

void connect(player);

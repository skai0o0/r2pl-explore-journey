import { ColyseusSDK, type Room } from "@colyseus/sdk";
import type { GameView } from "../../shared/gameplay/commands.ts";
import {
  edgeNeighbors,
  headquartersOwner,
  isExpansionEdge,
} from "../../shared/gameplay/expansion.ts";
import {
  FIRST_LANDMARK_BY_SLOT,
  GAME_CONFIG,
  LANDMARKS,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { TileAction } from "../../shared/gameplay/tileAction.ts";
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
import {
  chunkCoordinatesForIndex,
  chunkId,
  localIndex,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { gameFetch } from "./gameHttp.ts";
import { GameplayUI } from "./gameplayUI.ts";
import { fetchModelManifest } from "./modelManifest.ts";
import { OperatorUI } from "./operatorUI.ts";
import { MiniMap } from "./ui/miniMap.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
import {
  findExpansionTile,
  objectDisplayName,
  uiModeFromSearch,
} from "./ui/playerPresentation.ts";
import { StatsOverlay } from "./ui/statsOverlay.ts";
import {
  deriveDevCreditState,
  type PickedTile,
  WorldView,
} from "./worldView.ts";
import "./style.css";

import {
  type DevPlayer,
  LEGACY_DEV_SESSION,
} from "../../shared/integration/devSession.ts";
import {
  bootFailure,
  completeStage,
  finishBoot,
  loadingStage,
} from "./bootScreen.ts";
import { loadGameSession } from "./portalSession.ts";

// Codex-owned transport bootstrap contract; existing presentation stays intact.
const session = await loadGameSession();
const publicWorld =
  session === LEGACY_DEV_SESSION
    ? []
    : (
        (await (await gameFetch("/api/fixture/world")).json()) as {
          objects: WorldObject[];
        }
      ).objects;
// Preload availability before WorldView synchronously chooses GLB or fallback.
loadingStage(2);
await fetchModelManifest();
const miniMap = new MiniMap();
miniMap.setObjects(publicWorld);

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
  fixtureOnly: boolean;
  earnedRunningPoints?: string;
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
  "websocketUrl" in session
    ? session.websocketUrl
    : `ws://${location.hostname}:${session.websocketPort}`,
);
let player: Player =
  players.find(
    (item) => item.token === sessionStorage.getItem("r2pl-fixture-player"),
  ) ?? players[0]!;
let privateObjects: readonly WorldObject[] = [];
let replica = new ProjectionReplica(player.slot);
let room: Room | undefined;
let selected: PickedTile | undefined;
let selectedBuilding: WorldObject | undefined;
let generation = 0;
let subscribeTimer: number | undefined;
let balanceTimer: number | undefined;
let reconnectTimer: number | undefined;
let subscribed = "";
let profileBalance: string | undefined;
let profileCost: string | undefined;
let profileRequest = 0;
const pending = new Map<string, PendingAction>();
let bootComplete = false,
  bootProfile = false;
const bootChunks = new Set<number>();
const loadedChunks = new Set<number>();
function checkBoot(): void {
  if (bootComplete || !bootProfile || !room || bootChunks.size) return;
  bootComplete = true;
  completeStage(3);
  loadingStage(4);
  requestAnimationFrame(() => requestAnimationFrame(() => finishBoot()));
}
let tileContext: TileAction | undefined;
let contextSignature = "";
let contextRequest = 0;
let contextAbort: AbortController | undefined;
let autoTarget: number | undefined;
let autoExplore = localStorage.getItem("r2pl-auto-explore") === "true";
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

function requestTileContext(tile: PickedTile): void {
  const signature = [
    generation,
    tile.index,
    ...[tile.index, ...edgeNeighbors(tile.index)].map((index) => {
      const { chunkX, chunkZ } = chunkCoordinatesForIndex(index);
      const id = chunkId(chunkX, chunkZ);
      const { x, z } = tileCoordinates(index);
      return replica.hasChunk(id)
        ? String(!!(replica.maskAt(id, localIndex(x, z)) & (1 << player.slot)))
        : "?";
    }),
  ].join(":");
  if (signature === contextSignature) return;
  contextSignature = signature;
  tileContext = undefined;
  contextAbort?.abort();
  const controller = new AbortController();
  contextAbort = controller;
  const request = ++contextRequest;
  const token = player.token;
  if (session === LEGACY_DEV_SESSION) {
    tileContext = {
      tileIndex: tile.index,
      action: "explore",
      points: Number(profileCost ?? 0),
    };
    return;
  }
  void gameFetch(`/api/game/tile?index=${tile.index}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Tile context unavailable");
      const context = (await response.json()) as TileAction;
      if (
        request !== contextRequest ||
        selected?.index !== tile.index ||
        player.token !== token
      )
        return;
      tileContext = context;
      updateTile();
      if (
        autoTarget === tile.index &&
        autoExplore &&
        context.action === "explore" &&
        !ui.explore.disabled
      ) {
        autoTarget = undefined;
        explore();
      }
    })
    .catch(() => {
      if (request === contextRequest && !controller.signal.aborted) {
        contextSignature = "";
        ui.knowledge.textContent = "Chưa đồng bộ được ô. Chạm lại để thử.";
      }
    });
}

function updateTile(): void {
  get("explore-button").closest<HTMLElement>(".tile-panel")!.hidden = !selected;
  if (!selected) return;
  const object = selectedBuilding;
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
    ui.explore.textContent = "Mở Chi Tiết / Tương Tác";
    return;
  }
  if (owned) {
    ui.knowledge.textContent =
      "Ô này đã mở. Bấm Tìm ô để mở hoặc chọn ô mới chung cạnh với Tri thức trường mình.";
    ui.explore.disabled = true;
    ui.explore.textContent = "Đã mở · 0 Points";
    return;
  }
  if (expansionBlocked(selected)) {
    ui.knowledge.textContent =
      "Chọn ô chung cạnh với vùng Tri thức. HQ trường khác được bảo vệ.";
    ui.explore.disabled = true;
    ui.explore.textContent = "Cần ô kề 4 cạnh";
    return;
  }
  requestTileContext(selected);
  const context =
    tileContext?.tileIndex === selected.index ? tileContext : undefined;
  ui.explore.disabled =
    !room ||
    !context ||
    context.action === "blocked" ||
    context.action === "owned";
  ui.knowledge.textContent = !context
    ? "Đang kiểm tra ô…"
    : context.action === "study"
      ? "Giao lưu với Tri thức của trường khác."
      : context.action === "explore"
        ? "Mở rộng vùng Tri thức của trường bạn."
        : "Ô này chưa thể mở.";
  ui.explore.textContent = !context
    ? "Đang kiểm tra…"
    : context.action === "study"
      ? `Giao Lưu Tri Thức · ${context.points} Points`
      : context.action === "explore"
        ? `Khám Phá Ô Này · ${context.points} Point`
        : "Không thể mở ô";
  if (
    context &&
    profileBalance !== undefined &&
    /^\d+$/.test(profileBalance) &&
    BigInt(profileBalance) < BigInt(context.points)
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
    const response = await gameFetch("/api/fixture/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(GAME_CONFIG.integration.bootstrapTimeoutMs),
    });
    if (response.status === 401 && !session.fixtureOnly) {
      sessionStorage.removeItem("r2pl-portal-session");
      location.reload();
      return;
    }
    if (!response.ok) throw new Error(`Profile ${response.status}`);
    const profile = (await response.json()) as Profile;
    if (
      attempt !== generation ||
      request !== profileRequest ||
      token !== player.token ||
      profile.schoolSlot !== player.slot ||
      profile.fixtureOnly !== session.fixtureOnly
    )
      return;
    ui.school.textContent = profile.schoolName;
    ui.player.textContent = profile.name;
    ui.balance.textContent = profile.balance;
    ui.cost.textContent = profile.cost;
    profileBalance = profile.balance;
    profileCost = profile.cost;
    stats.updateStats({
      studentName: profile.name,
      displayName:
        session.fixtureOnly &&
        !isDev &&
        /Explorer|explorer|connector|steward/.test(profile.name)
          ? `Chiến binh ${profile.schoolName}`
          : profile.name,
      schoolId: SCHOOLS[player.slot]?.id ?? "hcmut",
      schoolName: profile.schoolName,
      schoolColor: SCHOOLS[player.slot]?.color ?? "#fff",
      points: Number(profile.balance),
      earnedRunningPoints: Number(profile.earnedRunningPoints ?? 0),
    });
    bootProfile = true;
    completeStage(1);
    checkBoot();
    updateTile();
    document.body.dataset.school = player.slot === 0 ? "dawn" : "dusk";
  } catch {
    if (!bootComplete)
      bootFailure("Chưa tải được hồ sơ và ví của bạn. Vui lòng kết nối lại.");
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
  (tile, object) => {
    if (operator?.relocating) {
      operator.relocate(tile.x, tile.z);
      return false;
    }
    selected = tile;
    selectedBuilding = object;
    contextSignature = "";
    autoTarget = !object && autoExplore ? tile.index : undefined;
    updateTile();
    world.setSelectedObject(object?.id);
    if (
      autoTarget === tile.index &&
      tileContext?.action === "explore" &&
      !ui.explore.disabled
    ) {
      autoTarget = undefined;
      explore();
    }
  },
  () => {
    scheduleSubscribe();
    const camera = world.viewState;
    miniMap.updateCamera(camera.x, camera.z, camera.span);
  },
  (hovered) => {
    updateHover(hovered);
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
          if (
            !operator?.relocating &&
            gameplay.canShowObject(obj) &&
            obj.kind !== "hq"
          ) {
            gameplay.pick(obj);
          }
        },
      }
    : {
        onPickObject: (obj) => {
          if (
            !operator?.relocating &&
            gameplay.canShowObject(obj) &&
            obj.kind !== "hq"
          ) {
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
stats.onWalletRefreshRequested = () => void refreshProfile();
stats.onExploreRequested = () => {
  if (!room) return;
  const index = findExpansionTile(
    replica,
    loadedChunks,
    player.slot,
    session.headquarters ?? [],
    homeLandmark(),
  );
  if (index === undefined) {
    activity(
      "Chưa tìm thấy ô biên trong vùng đã tải. Về trụ sở rồi thử lại.",
      "normal",
    );
    return;
  }
  const { x, z } = tileCoordinates(index);
  selected = {
    index,
    x,
    z,
    chunk: chunkId(Math.floor(x / 64), Math.floor(z / 64)),
    local: localIndex(x, z),
  };
  selectedBuilding = undefined;
  contextSignature = "";
  autoTarget = undefined;
  world.setSelectedObject(undefined);
  world.select(selected);
  world.animateFocus(x + 0.5, z + 0.5, 60);
  updateTile();
};
const refreshVisibleProfile = () => {
  if (!document.hidden && session !== LEGACY_DEV_SESSION) void refreshProfile();
};
window.setInterval(
  refreshVisibleProfile,
  GAME_CONFIG.integration.profileRefreshMs,
);
window.addEventListener("focus", refreshVisibleProfile);
document.addEventListener("visibilitychange", refreshVisibleProfile);
if (isDev) Object.assign(window, { world });
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
  void gameFetch("/api/game/ranking")
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
  void gameFetch("/api/fixture/world", { cache: "no-store" })
    .then((r) => r.json())
    .then((v: { objects: WorldObject[] }) => {
      let changed = false;
      for (const obj of v.objects) {
        const found = publicWorld.find((p) => p.id === obj.id);
        if (found) {
          if (
            found.ownerSchoolSlot !== obj.ownerSchoolSlot ||
            found.ownerSchoolId !== obj.ownerSchoolId ||
            found.x !== obj.x ||
            found.z !== obj.z
          ) {
            Object.assign(found, obj);
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
    const sharedTiles = new Map<number, readonly number[]>();
    for (const cluster of view.shared)
      for (const tile of cluster.tileIndexes ?? [])
        sharedTiles.set(tile, cluster.pair);
    world.setSharedTiles(sharedTiles);
    stats.updateExploration(
      view.revealedTiles,
      (view.revealedTiles /
        (GAME_CONFIG.world.width * GAME_CONFIG.world.height)) *
        100,
    );
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
    privateObjects = view.chests;
    world.setPrivateObjects(view.chests);
    miniMap.setObjects([...publicWorld, ...view.chests]);
  },
  () => void refreshProfile(),
  session.campaignId ?? "",
  (id) => world.setChestOpen(id, true),
  isDev,
  () => true,
  (targetX, targetZ) => {
    world.animateFocus(targetX, targetZ, 120);
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
const quickLabel = document.createElement("label");
quickLabel.className = "auto-explore-toggle";
const quickInput = document.createElement("input");
quickInput.type = "checkbox";
quickInput.checked = autoExplore;
quickInput.addEventListener("change", () => {
  autoTarget = undefined;
  autoExplore = quickInput.checked;
  localStorage.setItem("r2pl-auto-explore", String(autoExplore));
});
quickLabel.append(quickInput, "⚡ Mở Nhanh 1 Chạm");
ui.explore.closest(".tile-panel")!.append(quickLabel);
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
  if (!bootComplete && !bootChunks.size)
    for (const id of ids) bootChunks.add(id);
  ui.viewport.textContent = String(ids.length);
  room.sendBytes("m2", encodeSubscribe(ids));
}

function explore(): void {
  const object = selectedBuilding;
  if (object && object.kind !== "hq") {
    if (gameplay.canShowObject(object)) gameplay.pick(object);
    return;
  }
  if (!room || !selected) {
    activity("Chọn một ô khi đã kết nối.", "error");
    return;
  }

  const actTile = selected;
  if ([...pending.values()].some((a) => a.tile.index === actTile.index)) return;
  const context =
    tileContext?.tileIndex === actTile.index ? tileContext : undefined;
  if (!context || (context.action !== "explore" && context.action !== "study"))
    return;

  if (expansionBlocked(actTile)) {
    updateTile();
    scheduleSubscribe();
    activity(
      "Ô này chưa nằm sát vùng tri thức của trường hoặc thuộc HQ trường khác.",
      "normal",
    );
    return;
  }
  const required = context.points;
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
      ...(session === LEGACY_DEV_SESSION ? {} : { intent: context.action }),
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
        contextSignature = "";
        autoTarget = undefined;
        world.setPending(Array.from(pending.values()).at(-1)?.tile);
        updatePending();
        if (ack.status === ACK_STATUS.TEST_APPLIED) {
          activity("Đã mở tri thức cho trường bạn.", "success");
          world.playReveal(action.tile.x, action.tile.z, player.slot);

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
        } else {
          const errDetail =
            ack.reason === REASON.WRONG_ACTION
              ? "Ô này không phù hợp với thao tác đã chọn. Chạm lại ô để cập nhật hành động."
              : "Ô này chưa chung cạnh biên giới hoặc bạn chưa đủ Điểm Tri Thức.";
          activity(errDetail, "error");
          world.playReject(action.tile.x, action.tile.z);
        }
        updateTile();
        refreshBalanceSoon();
        break;
      }
      case M2_KIND.SNAPSHOT: {
        const snapshot = decodeSnapshot(frame.payload);
        replica.applySnapshot(snapshot);
        loadedChunks.add(snapshot.chunkId);
        world.paintChunk(snapshot.chunkId, replica);
        miniMap.paintProjection(snapshot.chunkId, replica);
        bootChunks.delete(snapshot.chunkId);
        checkBoot();
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
          miniMap.paintProjection(delta.chunkId, replica);
          updateTile();
          refreshBalanceSoon();
        }
        break;
      }
      case M2_KIND.ERROR:
        activity("Chưa thể thực hiện thao tác. Vui lòng thử lại.", "error");
        break;
    }
  } catch {
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
  loadedChunks.clear();
  selected = undefined;
  selectedBuilding = undefined;
  contextSignature = "";
  tileContext = undefined;
  contextAbort?.abort();
  contextRequest++;
  world.setSchool(player.slot);
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
    let socketToken = player.token;
    if (!session.fixtureOnly) {
      const response = await gameFetch("/api/portal/ws-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        location.reload();
        return;
      }
      if (!response.ok) throw new Error("Socket ticket unavailable");
      socketToken = ((await response.json()) as { ticket: string }).ticket;
    }
    const joined = await sdk.joinOrCreate("m2", { token: socketToken });
    if (attempt !== generation) {
      void joined.leave();
      return;
    }
    room = joined;
    joined.onMessage("m2", (bytes: Uint8Array) => {
      if (attempt === generation) handleFrame(bytes);
    });
    joined.onLeave((code) => {
      if (attempt !== generation) return;
      if (code === 4001 && !session.fixtureOnly) {
        sessionStorage.removeItem("r2pl-portal-session");
        location.reload();
        return;
      }
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
    if (!bootComplete)
      bootFailure("Chưa kết nối được bản đồ. Bạn có thể thử lại.");
    status("Chưa thể kết nối", false);
    activity("Chưa thể vào bản đồ. Bấm Kết nối lại để thử.", "error");
  }
}

for (const option of players) {
  ui.select.add(new Option(option.label, option.token));
}
ui.select.value = player.token;
if (!session.fixtureOnly) {
  ui.select.disabled = true;
  const logout = document.createElement("button");
  logout.textContent = "Đăng xuất";
  logout.style.cssText =
    "margin-left:12px;padding:8px 12px;border:1px solid #ffffff30;border-radius:8px;background:#ffffff10;color:inherit;cursor:pointer";
  logout.onclick = async () => {
    await gameFetch("/api/portal/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${player.token}`,
      },
      body: "{}",
    });
    sessionStorage.removeItem("r2pl-portal-session");
    location.reload();
  };
  document.querySelector(".top-bar .connection")!.append(logout);
}
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
  selectedBuilding = undefined;
  autoTarget = undefined;
  contextAbort?.abort();
  contextRequest++;
  world.select(undefined);
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

completeStage(2);
loadingStage(3);
void connect(player);

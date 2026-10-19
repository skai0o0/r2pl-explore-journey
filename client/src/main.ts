import { isUiOverlayOpen } from "./ui/overlay.ts";
import { SelectedTilePanel } from "./ui/selectedTilePanel.ts";
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
  decodePublicDelta,
  decodePublicSnapshot,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeResync,
  encodeSubscribe,
  M2_KIND,
  REASON,
} from "../../shared/protocol/m2.ts";
import {
  ProjectionReplica,
  PublicKnowledgeReplica,
} from "../../shared/protocol/replica.ts";
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
import { SCENE_PRESENTATION as P } from "./scenePresentation.ts";
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
import "./ui/compactUI.css";

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
import { loadGameSession, returnToEventPortal } from "./portalSession.ts";

// Codex-owned transport bootstrap contract; existing presentation stays intact.
const showDemoDisclaimer = location.hostname === "play.skai0o0.id.vn";
document.body.dataset.demoNotice = String(showDemoDisclaimer);
const demoDisclaimer = document.getElementById("demo-disclaimer");
if (demoDisclaimer) demoDisclaimer.hidden = !showDemoDisclaimer;
const session = await loadGameSession();
const publicWorld: WorldObject[] =
  session === LEGACY_DEV_SESSION
    ? []
    : await gameFetch("/api/fixture/world").then(async (response) => {
        if (!response.ok) throw new Error("World layout unavailable");
        return ((await response.json()) as { objects: WorldObject[] }).objects;
      });
// Preload availability before WorldView synchronously chooses GLB or fallback.
loadingStage(2);
await fetchModelManifest();
const miniMap = new MiniMap();
const publicKnowledge = new PublicKnowledgeReplica();
miniMap.setObjects(publicWorld);

const uiMode =
  "mode" in session && session.mode === "portal"
    ? "player"
    : uiModeFromSearch(location.search);
const isDev = uiMode === "dev";
document.body.dataset.mode = uiMode;
document.body.dataset.debug = String(isDev);
if (uiMode === "player") {
  miniMap.element.style.display = "none";
}
if (isDev || session.fixtureOnly) {
  if (isDev) {
    const template = document.getElementById(
      "dev-tools-template",
    ) as HTMLTemplateElement | null;
    if (template) {
      document
        .querySelector(".game-shell")!
        .append(template.content.cloneNode(true));
    }
  }
  const devToolsSection = document.getElementById("dev-tools-section");
  if (devToolsSection) {
    devToolsSection.hidden = false;
    const eyebrow = devToolsSection.querySelector(".eyebrow");
    if (eyebrow && !isDev) {
      eyebrow.textContent = "CHỌN TRƯỜNG & TÀI KHOẢN (STANDALONE)";
    }
  }
}
const mapTools = document.querySelector(".map-tools");
if (mapTools) miniMap.element.append(mapTools);
const players = session.players;
type Player = DevPlayer;

interface Profile {
  name: string;
  schoolName: string;
  schoolSlot: number;
  balance: string;
  hasSpentPoints: boolean;
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
  "websocketUrl" in session && session.websocketUrl
    ? session.websocketUrl
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${import.meta.env.DEV ? "/colyseus" : ""}`,
);
let player: Player =
  players.find(
    (item) =>
      item.token ===
      (sessionStorage.getItem("r2pl-fixture-player") ||
        localStorage.getItem("r2pl-fixture-player")),
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
const resyncRequestedAt = new Map<number, number>();
function requestChunkResync(id: number): void {
  if (!room) return;
  const now = performance.now();
  if (now - (resyncRequestedAt.get(id) ?? -Infinity) < 1000) return;
  resyncRequestedAt.set(id, now);
  room.sendBytes("m2", encodeResync(id));
}
const selectedTilePanel = new SelectedTilePanel(document);
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
  get("hud-online-dot").dataset.online = String(online);
  get("hud-online-dot").title = label;
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
      points: Number(profileCost ?? 1),
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
  ui.explore.closest<HTMLElement>(".tile-panel")!.dataset.empty = String(
    !selected,
  );
  if (!selected) {
    ui.tile.textContent = "Chạm bản đồ";
    ui.badge.textContent = "CHƯA CHỌN";
    ui.badge.className = "tiny-tag";
    ui.badge.removeAttribute("data-state");
    ui.knowledge.textContent = "Chạm vào ô kề cạnh trên bản đồ để khám phá";
    ui.explore.disabled = true;
    ui.explore.textContent = "Mở ô này";
    ui.action.textContent = "";
    return;
  }
  const object = selectedBuilding;
  const owned =
    replica.hasChunk(selected.chunk) &&
    !!(replica.maskAt(selected.chunk, selected.local) & (1 << player.slot));
  const discovered =
    replica.hasChunk(selected.chunk) &&
    replica.isDiscovered(selected.chunk, selected.local);
  ui.tile.textContent = object
    ? gameplay.objectName(object)
    : `${selected.x}, ${selected.z}`;
  ui.action.textContent = "";
  ui.badge.textContent = owned
    ? "ĐÃ MỞ"
    : discovered
      ? "ĐÃ KHÁM PHÁ"
      : "CHƯA KHÁM PHÁ";
  ui.badge.className = `tiny-tag ${owned ? "owned" : "fogged"}`;
  if (owned) {
    ui.badge.setAttribute("data-state", "owned");
  } else {
    ui.badge.removeAttribute("data-state");
  }
  const waiting = [...pending.values()].some(
    (a) => a.tile.index === selected!.index,
  );
  if (waiting) {
    ui.knowledge.textContent = "Đang xác nhận thao tác của bạn…";
    ui.badge.textContent = "ĐANG XỬ LÝ";
    ui.badge.setAttribute("data-state", "pending");
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
    ui.explore.textContent = "Xem chi tiết";
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
        ? `Mở ô này · ${context.points} Point`
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
    selectedTilePanel.updateProfile(profile.hasSpentPoints);
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
      schoolSlot: player.slot,
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
    if (!autoExplore) {
      stats.toggleTools(false);
    }
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
  selectedTilePanel.open();
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
  world.animateFocus(player.home.x, player.home.z, P.homeSpan);

if (session.fixtureOnly) {
  const schoolMap = new Map<number, DevPlayer>();
  for (const p of players) {
    if (!schoolMap.has(p.slot)) {
      schoolMap.set(p.slot, p);
    }
  }

  const availableSchools = SCHOOLS.map((s) => {
    const p = schoolMap.get(s.slot);
    return {
      slot: s.slot,
      id: s.id,
      shortName: s.shortName,
      fullName: s.fullName.replace(/_/g, " "),
      color: s.color,
      accent: s.accent,
      playerToken: p?.token ?? "",
      playerName: p?.label ?? `Chiến binh ${s.shortName}`,
    };
  }).filter((s) => s.playerToken !== "");

  stats.setAvailableSchools(availableSchools);

  stats.onSchoolSelected = (slot: number) => {
    const targetPlayer = players.find((p) => p.slot === slot);
    if (targetPlayer && targetPlayer.token !== player.token) {
      void connect(targetPlayer);
      NotificationBanner.show({
        title: "Đã đổi trường",
        body: `Bạn đang khám phá với tư cách sinh viên ${targetPlayer.schoolName}`,
      });
    }
  };

  const hudSchoolSwitch = document.getElementById("hud-school-switch");
  if (hudSchoolSwitch) {
    hudSchoolSwitch.hidden = false;
    hudSchoolSwitch.addEventListener("click", () => {
      stats.openDialog("student");
    });
  }

  const toolSwitchSchool = document.getElementById("tool-switch-school");
  if (toolSwitchSchool) {
    toolSwitchSchool.hidden = false;
    toolSwitchSchool.addEventListener("click", () => {
      stats.toggleTools(false);
      stats.openDialog("student");
    });
  }
}
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
window.setInterval(() => {
  void gameFetch("/api/fixture/world", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("Layout unavailable");
      return r.json();
    })
    .then((v: { objects: WorldObject[] }) => {
      if (JSON.stringify(v.objects) === JSON.stringify(publicWorld)) return;
      world.updateObjects(v.objects);
      publicWorld.splice(0, publicWorld.length, ...v.objects);
      miniMap.setObjects([...publicWorld, ...privateObjects]);
      if (selectedBuilding)
        selectedBuilding = publicWorld.find(
          (o) => o.id === selectedBuilding!.id,
        );
      if (session.headquarters)
        for (const hq of publicWorld.filter((o) => o.kind === "hq")) {
          const area = session.headquarters.find(
            (h) => h.schoolSlot === hq.schoolSlot,
          );
          if (area)
            Object.assign(area, {
              x: hq.x - hq.width / 2,
              z: hq.z - hq.height / 2,
            });
          for (const p of players.filter((p) => p.slot === hq.schoolSlot))
            Object.assign(p.home, { x: hq.x, z: hq.z });
        }
    })
    .catch(() => {});
}, GAME_CONFIG.editor.pollMs);
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
      buffs: view.activeBeacon
        ? [
            {
              name: view.activeBeacon.name,
              description: view.activeBeacon.description,
            },
          ]
        : [],
    });
    get("tool-beacon-scout").hidden = !view.canScout;
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
  },
  () => {
    void gameplay.command({
      action: "running",
      ...(latestView?.runningMode === "http" ? {} : { amount: 1000 }),
    });
  },
);
miniMap.onPanRequested = (x, z) => world.animateFocus(x, z, 100);
gameplay.onFindExpansion = () => stats.onExploreRequested?.();
miniMap.onPanLive = (x, z) => world.focus(x, z, 100);
miniMap.onZoomIn = () => world.zoom(0.72);
miniMap.onZoomOut = () => world.zoom(1.38);
miniMap.onRecenter = () =>
  world.animateFocus(player.home.x, player.home.z, P.homeSpan);
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
quickLabel.append(quickInput, "Mở nhanh một chạm");
get("tools-panel").append(quickLabel);
const overviewButton = get<HTMLButtonElement>("overview-button");
const worldHost = get<HTMLElement>("world-view");

function announceCameraMode(log: boolean): void {
  const label =
    world.cameraMode === "isometric" ? "Góc nhìn 3D" : "Góc nhìn từ trên";
  overviewButton.title = "Toàn bản đồ (O)";
  get("camera-button").setAttribute("aria-label", `Đổi góc nhìn · ${label}`);
  worldHost.setAttribute(
    "aria-label",
    `Bản đồ Hành trình Khám phá. ${label}. Kéo để pan; cuộn để zoom; kéo chuột phải hoặc giữa để xoay và nghiêng. Q/E xoay, I đổi góc nhìn. Hai ngón để pan, zoom và xoay.`,
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
          ui.action.textContent = "";
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
          requestChunkResync(delta.chunkId);
        } else if (result === "applied") {
          world.paintTile(delta.chunkId, delta.localIndex, replica);
          miniMap.paintProjection(delta.chunkId, replica);
          updateTile();
          refreshBalanceSoon();
        }
        break;
      }
      case M2_KIND.PUBLIC_SNAPSHOT: {
        const snapshot = decodePublicSnapshot(frame.payload);
        publicKnowledge.applySnapshot(snapshot);
        if (replica.hasChunk(snapshot.chunkId))
          world.paintPublicChunk(snapshot.chunkId, replica, publicKnowledge);
        break;
      }
      case M2_KIND.PUBLIC_DELTA: {
        const delta = decodePublicDelta(frame.payload),
          result = publicKnowledge.applyDelta(delta);
        if (result === "resync")
          requestChunkResync(delta.chunkId);
        else if (result === "applied" && replica.hasChunk(delta.chunkId))
          world.paintPublicTile(
            delta.chunkId,
            delta.localIndex,
            replica,
            publicKnowledge,
          );
        break;
      }
      case M2_KIND.ERROR:
        activity("Chưa thể thực hiện thao tác. Vui lòng thử lại.", "error");
        break;
    }
  } catch {
    activity("Đang đồng bộ lại bản đồ…", "error");
    for (const id of world.visibleChunkIds(selected?.chunk))
      requestChunkResync(id);
  }
}

async function connect(nextPlayer: Player): Promise<void> {
  const resetWorld = generation === 0 || player.token !== nextPlayer.token || player.slot !== nextPlayer.slot;
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
  resyncRequestedAt.clear();
  if (previous) void previous.leave();
  player = nextPlayer;
  if (resetWorld) {
    privateObjects = [];
    world.setPrivateObjects([]);
    miniMap.setObjects(publicWorld);
    gameplay.select(player);
    ui.balance.textContent = "—";
  }
  ui.player.textContent = player.label;
  ui.school.textContent = player.schoolName;
  if (resetWorld) {
    profileBalance = undefined;
    profileCost = undefined;
    selectedTilePanel.reset();
  }
  sessionStorage.setItem("r2pl-fixture-player", player.token);
  localStorage.setItem("r2pl-fixture-player", player.token);
  if (ui.select.value !== player.token) {
    ui.select.value = player.token;
  }
  if (resetWorld) {
    replica = new ProjectionReplica(player.slot);
    publicKnowledge.clear();
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
      session === LEGACY_DEV_SESSION ? 275 : P.homeSpan,
    );
  }
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

ui.select.replaceChildren();
const schoolGroups = new Map<number, HTMLOptGroupElement>();
for (const option of players) {
  let group = schoolGroups.get(option.slot);
  if (!group) {
    const schoolCfg = SCHOOLS[option.slot];
    const groupLabel = schoolCfg
      ? `${schoolCfg.shortName} — ${schoolCfg.fullName.replace(/_/g, " ")}`
      : option.schoolName;
    group = document.createElement("optgroup");
    group.label = groupLabel;
    schoolGroups.set(option.slot, group);
    ui.select.appendChild(group);
  }
  const opt = document.createElement("option");
  opt.value = option.token;
  const rolePart = option.label.includes("·")
    ? option.label.split("·")[1]!.trim()
    : option.label;
  opt.textContent = `${option.schoolName} (${rolePart})`;
  group.appendChild(opt);
}
ui.select.value = player.token;
if (!session.fixtureOnly) {
  ui.select.disabled = true;
  const portalReturn = document.getElementById("tool-portal-return");
  if (portalReturn) {
    portalReturn.hidden = false;
    portalReturn.addEventListener("click", async () => {
      (portalReturn as HTMLButtonElement).disabled = true;
      try {
        await returnToEventPortal();
      } catch {
        (portalReturn as HTMLButtonElement).disabled = false;
        activity("Chưa thể trở về web giải chạy. Vui lòng thử lại.", "error");
      }
    });
  }
}
ui.select.addEventListener("change", () => {
  const next = players.find((item) => item.token === ui.select.value);
  if (next) void connect(next);
});

ui.explore.addEventListener("click", explore);
ui.retry.addEventListener("click", () => void connect(player));

document.getElementById("tool-zoom-in")?.addEventListener("click", () => {
  world.zoom(0.72);
});
document
  .getElementById("tool-beacon-scout")
  ?.addEventListener("click", () => void gameplay.command({ action: "scout" }));
document.getElementById("tool-zoom-out")?.addEventListener("click", () => {
  world.zoom(1.38);
});
document.getElementById("tool-rotate")?.addEventListener("click", () => {
  world.toggleCameraMode();
  announceCameraMode(false);
});
get("tool-orbit-left").addEventListener("click", () =>
  world.rotateCamera(P.camera.rotationStep),
);
get("tool-orbit-right").addEventListener("click", () =>
  world.rotateCamera(-P.camera.rotationStep),
);
get("tool-camera-reset").addEventListener("click", () => {
  world.resetCamera();
  announceCameraMode(false);
});

const fogSlider = document.getElementById(
  "fog-density-slider",
) as HTMLInputElement | null;
const fogVal = document.getElementById("fog-density-val");
if (fogSlider && fogVal) {
  fogSlider.addEventListener("input", () => {
    const val = Number(fogSlider.value);
    fogVal.textContent = `${val}%`;
    world.setMistBrightness(val / 48);
  });
}

// Bot simulation elements in Dev Tools section
const btnStartBots = document.getElementById(
  "btn-start-bots",
) as HTMLButtonElement | null;
const btnStopBots = document.getElementById(
  "btn-stop-bots",
) as HTMLButtonElement | null;
const botCountSelect = document.getElementById(
  "bot-count-select",
) as HTMLSelectElement | null;
const botSpeedSelect = document.getElementById(
  "bot-speed-select",
) as HTMLSelectElement | null;
const botStatusTag = document.getElementById("bot-status-tag");
const botActiveCount = document.getElementById("bot-active-count");
const botRateVal = document.getElementById("bot-rate-val");
const botTilesVal = document.getElementById("bot-tiles-val");

// Bot simulation elements in Top HUD and Floating Popover
const hudBotBtn = document.getElementById("hud-bot-sim-btn");
const hudBotTag = document.getElementById("hud-bot-tag");
const hudBotPopover = document.getElementById("hud-bot-popover");
const closeBotPopover = document.getElementById("close-bot-popover");
const popoverStartBtn = document.getElementById(
  "popover-btn-start",
) as HTMLButtonElement | null;
const popoverStopBtn = document.getElementById(
  "popover-btn-stop",
) as HTMLButtonElement | null;
const popoverCountSelect = document.getElementById(
  "popover-bot-count",
) as HTMLSelectElement | null;
const popoverSpeedSelect = document.getElementById(
  "popover-bot-speed",
) as HTMLSelectElement | null;
const popoverActiveCount = document.getElementById("popover-bot-active");
const popoverRateVal = document.getElementById("popover-bot-rate");
const popoverTilesVal = document.getElementById("popover-bot-tiles");
// This comes from the signed server session, never from URL/hostname heuristics.
const botRuntimeEnabled = session.fixtureOnly === true;
if (hudBotBtn) hudBotBtn.hidden = !botRuntimeEnabled || !isDev;
if (hudBotPopover && !isDev) hudBotPopover.hidden = true;
if (!botRuntimeEnabled) {
  hudBotBtn?.setAttribute("hidden", "");
  hudBotPopover?.setAttribute("hidden", "");
  document
    .getElementById("dev-tools-section")
    ?.querySelector(".bot-simulation")
    ?.setAttribute("hidden", "");
}

if (hudBotBtn && hudBotPopover) {
  hudBotBtn.addEventListener("click", () => {
    if (!botRuntimeEnabled || !isDev) return;
    hudBotPopover.hidden = !hudBotPopover.hidden;
  });
  closeBotPopover?.addEventListener("click", () => {
    hudBotPopover.hidden = true;
  });
}

const updateAllBotUI = (telemetry: {
  status?: string;
  activeBots?: number;
  actionsPerSecond?: number;
  totalActions?: number;
}) => {
  const isRunning =
    telemetry.status === "running" || telemetry.status === "starting";
  if (btnStartBots) btnStartBots.disabled = isRunning;
  if (btnStopBots) btnStopBots.disabled = !isRunning;
  if (botCountSelect) botCountSelect.disabled = isRunning;
  if (botSpeedSelect) botSpeedSelect.disabled = isRunning;

  if (popoverStartBtn) popoverStartBtn.disabled = isRunning;
  if (popoverStopBtn) popoverStopBtn.disabled = !isRunning;
  if (popoverCountSelect) popoverCountSelect.disabled = isRunning;
  if (popoverSpeedSelect) popoverSpeedSelect.disabled = isRunning;

  const statusText =
    telemetry.status === "running"
      ? "ĐANG CHẠY"
      : telemetry.status === "starting"
        ? "KHỞI ĐỘNG"
        : telemetry.status === "stopping"
          ? "ĐANG DỪNG"
          : "DỪNG";

  const statusBg =
    telemetry.status === "running"
      ? "rgba(0, 229, 255, 0.2)"
      : telemetry.status === "starting"
        ? "rgba(238, 203, 114, 0.2)"
        : telemetry.status === "stopping"
          ? "rgba(239, 68, 68, 0.2)"
          : "#1e293b";

  const statusColor =
    telemetry.status === "running"
      ? "var(--cyan-bright)"
      : telemetry.status === "starting"
        ? "#eecb72"
        : telemetry.status === "stopping"
          ? "#f87171"
          : "#94a3b8";

  for (const tag of [botStatusTag, hudBotTag]) {
    if (tag) {
      tag.textContent = statusText;
      tag.style.background = statusBg;
      tag.style.color = statusColor;
    }
  }

  const activeStr = String(telemetry.activeBots ?? 0);
  const rateStr = String(telemetry.actionsPerSecond ?? 0);
  const tilesStr = String(telemetry.totalActions ?? 0);

  if (botActiveCount) botActiveCount.textContent = activeStr;
  if (botRateVal) botRateVal.textContent = rateStr;
  if (botTilesVal) botTilesVal.textContent = tilesStr;

  if (popoverActiveCount) popoverActiveCount.textContent = activeStr;
  if (popoverRateVal) popoverRateVal.textContent = rateStr;
  if (popoverTilesVal) popoverTilesVal.textContent = tilesStr;
};

const pollAllBotStatus = async () => {
  if (!botRuntimeEnabled) return;
  try {
    const res = await gameFetch("/api/fixture/bots");
    if (res.ok) {
      const data = await res.json();
      updateAllBotUI(data);
    }
  } catch {
    // Ignored
  }
};

const doStartBots = async (count: number, speed: string) => {
  if (!botRuntimeEnabled) return;
  activity("Đang khởi động bot mô phỏng...", "normal");
  try {
    const res = await gameFetch("/api/fixture/bots/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, speed }),
    });
    if (res.ok) {
      const data = await res.json();
      updateAllBotUI(data);
      activity(
        `${data.activeBots ?? count} bot đã bắt đầu khám phá bản đồ!`,
        "success",
      );
    } else {
      activity("Chưa thể khởi động bot.", "error");
    }
  } catch {
    activity("Lỗi kết nối khi bật bot.", "error");
  }
};

const doStopBots = async () => {
  if (!botRuntimeEnabled) return;
  activity("Đang dừng toàn bộ bot...", "normal");
  try {
    const res = await gameFetch("/api/fixture/bots/stop", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      updateAllBotUI(data);
      activity("Đã dừng mô phỏng bot.", "normal");
    }
  } catch {
    activity("Lỗi khi dừng bot.", "error");
  }
};

btnStartBots?.addEventListener("click", () => {
  const count = botCountSelect ? Number(botCountSelect.value) : 200;
  const speed = botSpeedSelect ? botSpeedSelect.value : "realistic";
  void doStartBots(count, speed);
});
btnStopBots?.addEventListener("click", () => void doStopBots());

popoverStartBtn?.addEventListener("click", () => {
  const count = popoverCountSelect ? Number(popoverCountSelect.value) : 200;
  const speed = popoverSpeedSelect ? popoverSpeedSelect.value : "realistic";
  void doStartBots(count, speed);
});
popoverStopBtn?.addEventListener("click", () => void doStopBots());

if (botRuntimeEnabled) {
  window.setInterval(pollAllBotStatus, 2000);
  void pollAllBotStatus();
}

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

window.addEventListener("keydown", (event) => {
  if (isUiOverlayOpen()) return;
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
    stats.dialogOpen ||
    event.target instanceof HTMLButtonElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLInputElement ||
    (event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        event.target.closest("textarea,[role='textbox']"))) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  switch (event.key) {
    case "q":
    case "Q":
      world.rotateCamera(P.camera.rotationStep);
      break;
    case "e":
    case "E":
      world.rotateCamera(-P.camera.rotationStep);
      break;
    case "h":
    case "H":
      world.animateFocus(player.home.x, player.home.z, P.homeSpan);
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

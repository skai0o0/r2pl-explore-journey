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
  decodeError,
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
import { GameplayUI } from "./gameplayUI.ts";
import { OperatorUI } from "./operatorUI.ts";
import { CompassCard } from "./ui/compassCard.ts";
import { MiniMap } from "./ui/miniMap.ts";
import { StatsOverlay } from "./ui/statsOverlay.ts";
import { StudentActionDock } from "./ui/studentActionDock.ts";
import { TileTooltip } from "./ui/tileTooltip.ts";
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
import { RewardsPanel } from "./rewardsPanel.ts";

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
const miniMap = new MiniMap();
miniMap.setObjects(publicWorld);
const dock = new StudentActionDock();
const tooltip = new TileTooltip();
document.body.dataset.debug = "false";
const devToggle = document.createElement("button");
devToggle.className = "dev-toggle";
devToggle.textContent = "Dev tools";
devToggle.setAttribute("aria-pressed", "false");
devToggle.onclick = () => {
  const on = document.body.dataset.debug !== "true";
  document.body.dataset.debug = String(on);
  devToggle.setAttribute("aria-pressed", String(on));
};
document.body.append(devToggle);
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

function lacksTestCredits(): boolean {
  return deriveDevCreditState(profileBalance, profileCost) === "insufficient";
}

function showInsufficientCredits(): void {
  ui.explore.disabled = true;
  ui.explore.innerHTML =
    "<span>✦</span> Not enough Points <small>Explore unavailable</small>";
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
  if (selected) {
    const isThisPending = Array.from(pending.values()).some(
      (a) => a.tile.index === selected?.index,
    );
    if (isThisPending) {
      ui.explore.disabled = true;
      ui.explore.innerHTML =
        '<span class="spin">✦</span> Committing… <small>1 / 2 Points</small>';
      ui.badge.textContent = "COMMITTING";
      ui.badge.className = "badge-tag committing";
      return;
    }
  }
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

function updateTile(): void {
  if (!selected) {
    ui.tile.textContent = "— / —";
    ui.knowledge.textContent = "Select a tile on the map";
    ui.badge.textContent = "IDLE";
    ui.badge.className = "badge-tag";
    ui.explore.disabled = true;
    ui.explore.innerHTML =
      "<span>✦</span> Explore tile <small>1 / 2 Points</small>";
    return;
  }

  ui.tile.textContent = `${selected.x.toString().padStart(3, "0")} / ${selected.z.toString().padStart(3, "0")}`;

  const isPending = Array.from(pending.values()).some(
    (a) => a.tile.index === selected?.index,
  );
  if (isPending) {
    ui.knowledge.textContent = "Exploration sent · Awaiting PostgreSQL commit";
    ui.badge.textContent = "COMMITTING";
    ui.badge.className = "badge-tag committing";
    ui.explore.disabled = true;
    ui.explore.innerHTML =
      '<span class="spin">✦</span> Committing… <small>1 / 2 Points</small>';
    return;
  }

  if (expansionBlocked(selected)) {
    ui.knowledge.textContent =
      "Chỉ mở ô chung cạnh với tri thức của trường; HQ trường khác được bảo vệ.";
    ui.badge.textContent = "OUTSIDE FRONTIER";
    ui.badge.className = "badge-tag fogged";
    ui.explore.disabled = true;
    ui.explore.textContent = "Chọn ô liền kề vùng của trường";
    return;
  }

  // Check public fixtures
  if (
    session === LEGACY_DEV_SESSION &&
    selected.x === 215 &&
    selected.z === 235
  ) {
    ui.knowledge.textContent = "Dawn Headquarters · Public sanctuary fixture";
    ui.badge.textContent = "DAWN HQ";
    ui.badge.className = "badge-tag fixture";
  } else if (
    session === LEGACY_DEV_SESSION &&
    selected.x === 785 &&
    selected.z === 765
  ) {
    ui.knowledge.textContent = "Dusk Headquarters · Public sanctuary fixture";
    ui.badge.textContent = "DUSK HQ";
    ui.badge.className = "badge-tag fixture";
  } else if (selected.x === 510 && selected.z === 485) {
    ui.knowledge.textContent =
      "Scenic Landmark · Visual placeholder (no rewards)";
    ui.badge.textContent = "LANDMARK";
    ui.badge.className = "badge-tag fixture";
  } else if (!replica.hasChunk(selected.chunk)) {
    ui.knowledge.textContent =
      "Unsubscribed sector · Click to explore & subscribe";
    ui.badge.textContent = "STREAMING";
    ui.badge.className = "badge-tag streaming";
  } else {
    const isDiscovered = replica.isDiscovered(selected.chunk, selected.local);
    const isOwned =
      isDiscovered &&
      (replica.maskAt(selected.chunk, selected.local) & (1 << player.slot)) !==
        0;

    if (isOwned) {
      ui.knowledge.textContent =
        session.adjacentOnly &&
        headquartersOwner(selected.index, session.headquarters ?? []) ===
          player.slot
          ? `${player.schoolName} HQ · Vùng tri thức khởi tạo 20×20 · không tốn credit`
          : `${player.schoolName} territory · Authorized presence`;
      ui.badge.textContent = "OWNED";
      ui.badge.className = "badge-tag owned";
      ui.explore.disabled = true;
      ui.explore.innerHTML =
        "<span>✓</span> Already Explored <small>0 Points</small>";
      return;
    }

    if (isDiscovered) {
      ui.knowledge.textContent =
        "Discovered territory · Unclaimed university presence";
      ui.badge.textContent = "SCOUTED";
      ui.badge.className = "badge-tag scouted";
      if (lacksTestCredits()) {
        showInsufficientCredits();
      } else {
        ui.explore.disabled = !room;
        ui.explore.innerHTML =
          "<span>✦</span> Establish Knowledge <small>1 / 2 Points</small>";
      }
      return;
    }

    ui.knowledge.textContent = "Unexplored territory · Shrouded in Fog of War";
    ui.badge.textContent = "FOGGED";
    ui.badge.className = "badge-tag fogged";
  }

  if (lacksTestCredits()) {
    showInsufficientCredits();
  } else {
    ui.explore.disabled = !room;
    ui.explore.innerHTML =
      "<span>✦</span> Explore tile <small>1 / 2 Points</small>";
  }
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
      displayName: profile.name,
      schoolId: SCHOOLS[player.slot]?.id ?? "hcmut",
      schoolName: profile.schoolName,
      schoolColor: SCHOOLS[player.slot]?.color ?? "#fff",
      points: Number(profile.balance),
    });
    if (profile.inventory) {
      dock.setCrystals(Number(profile.inventory.crystals));
    }
    rewards.refresh();
    updateTile();
    document.body.dataset.school = player.slot === 0 ? "dawn" : "dusk";
    if (!welcomed.has(token) && profile.balance !== undefined) {
      welcomed.add(token);
      compass.welcome(profile.schoolName, profile.balance);
    }
  } catch {
    if (attempt === generation && token === player.token)
      activity("Balance temporarily unavailable", "error");
  }
}

function refreshBalanceSoon(): void {
  window.clearTimeout(balanceTimer);
  balanceTimer = window.setTimeout(() => void refreshProfile(), 180);
}

const rewards = new RewardsPanel(
  false,
  (token) => {
    if (token === player.token) void refreshProfile(token);
  },
  session.campaignId,
);

const world = new WorldView(
  get("world-view"),
  (tile) => {
    if (operator.relocating) {
      operator.relocate(tile.x, tile.z);
      return;
    }
    selected = tile;
    updateTile();
    const object = objectAt(tile.x, tile.z, [
      ...publicWorld,
      ...privateObjects,
    ]);
    if (object && object.kind !== "hq") gameplay.pick(object);
    else explore();
  },
  () => {
    scheduleSubscribe();
    const camera = world.viewState;
    miniMap.updateCamera(camera.x, camera.z, camera.span);
  },
  (hovered) => {
    updateHover(hovered);
    if (hovered)
      tooltip.show({
        x: hovered.x,
        z: hovered.z,
        owned: !!(
          replica.maskAt(hovered.chunk, hovered.local) &
          (1 << player.slot)
        ),
        discovered: replica.isDiscovered(hovered.chunk, hovered.local),
        adjacent: !expansionBlocked(hovered),
        object: objectAt(hovered.x, hovered.z, [
          ...publicWorld,
          ...privateObjects,
        ]),
      });
    else tooltip.hide();
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
          title: o.name,
          detail: `${o.width}×${o.height}`,
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
      }
    : {},
);

const operator = new OperatorUI(
  (x, z) => world.animateFocus(x, z, 100),
  (objects) => world.setEditorPreview(objects),
);
const stats = new StatsOverlay();
const compass = new CompassCard(publicWorld, {
  nearestOwned: (target) => world.nearestOwned(target),
  focus: (x, z, span) => world.animateFocus(x, z, span),
});
Object.assign(window, { world, compass });
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
        miniMap.setObjects(publicWorld);
        world.updateObjects(publicWorld);
      }
      if (
        JSON.stringify(v.objects.map((o) => o.id)) !== layoutDigest &&
        !document.querySelector(".layout-update")
      ) {
        const update = document.createElement("button");
        update.className = "layout-update";
        update.textContent = "Bản đồ đã cập nhật · Tải layout mới";
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
    world.setBeacons(view.landmarks);
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
);
miniMap.onPanRequested = (x, z) => world.animateFocus(x, z, 100);
miniMap.onPanLive = (x, z) => world.focus(x, z, 100);
miniMap.onZoomIn = () => world.zoom(0.72);
miniMap.onZoomOut = () => world.zoom(1.38);
miniMap.onRecenter = () =>
  world.animateFocus(player.home.x, player.home.z, 100);
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
  const label = world.cameraMode === "isometric" ? "Isometric 3D" : "Top-down";
  overviewButton.title = `World overview (O) · ${label} view · toggle view (I)`;
  worldHost.setAttribute(
    "aria-label",
    `Interactive thousand by thousand tile world, ${label} view. Press I to toggle camera view.`,
  );
  if (log) activity(`${label} camera · press I to toggle view`);
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
  if (!room || !selected) {
    activity("Select a tile while connected", "error");
    return;
  }
  if (expansionBlocked(selected)) {
    updateTile();
    scheduleSubscribe();
    activity(
      "Ô này chưa nằm sát vùng tri thức của trường hoặc thuộc HQ trường khác.",
      "normal",
    );
    return;
  }
  if (lacksTestCredits()) {
    showInsufficientCredits();
    activity("Not enough Points to explore", "normal");
    return;
  }
  const key = crypto.getRandomValues(new Uint8Array(16));
  const action: PendingAction = {
    key: keyHex(key),
    frame: encodeExplore({
      key,
      tileIndex: selected.index,
      ruleVersion: session === LEGACY_DEV_SESSION ? 0 : GAME_CONFIG.ruleVersion,
    }),
    tile: selected,
    token: player.token,
  };
  pending.set(action.key, action);
  world.setPending(selected);
  updatePending();
  updateTile();
  activity(
    `Exploring ${selected.x}, ${selected.z} · awaiting durable commit`,
    "pending",
  );
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
        const place = `${action.tile.x}, ${action.tile.z}`;
        if (ack.status === ACK_STATUS.TEST_APPLIED) {
          activity(`Explored ${place} · committed`, "success");
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
          activity(`${place} already explored · no credit spent`, "normal");
        } else {
          const reasonCode =
            Object.entries(REASON).find(
              ([, value]) => value === ack.reason,
            )?.[0] ?? String(ack.reason);
          activity(`Exploration failed (${reasonCode})`, "error");
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
          updateTile();
          refreshBalanceSoon();
        }
        break;
      }
      case M2_KIND.ERROR:
        activity(
          `Server request rejected (${decodeError(frame.payload)})`,
          "error",
        );
        break;
    }
  } catch (error) {
    activity(
      `View needs resynchronization: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    for (const id of world.visibleChunkIds(selected?.chunk))
      room?.sendBytes("m2", encodeResync(id));
  }
}

async function connect(nextPlayer: Player): Promise<void> {
  const attempt = ++generation;
  window.clearTimeout(reconnectTimer);
  if (player.token !== nextPlayer.token) {
    ui.activity.replaceChildren();
    ui.action.textContent = "Switching synthetic explorer…";
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
  rewards.select(player.token, player.label);
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
  status("Connecting…", false);
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
      status("Disconnected · reconnecting", false);
      reconnectTimer = window.setTimeout(() => void connect(player), 1200);
    });
    status("Connected · protocol v1", true);
    activity(`Entered ${player.schoolName} world`, "success");
    subscribeNow();
    for (const action of pending.values()) {
      if (action.token === player.token) joined.sendBytes("m2", action.frame);
    }
  } catch {
    if (attempt !== generation) return;
    status("Server unavailable", false);
    activity("Could not enter world · use Reconnect", "error");
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

get("home-button").addEventListener("click", () =>
  world.animateFocus(player.home.x, player.home.z, 200),
);
get("landmark-button").addEventListener("click", () => {
  const first = homeLandmark();
  world.animateFocus(first.x, first.z, 200);
});
overviewButton.addEventListener("click", () =>
  world.animateFocus(500, 500, 1000),
);
get("zoom-in").addEventListener("click", () => world.zoom(0.72));
get("zoom-out").addEventListener("click", () => world.zoom(1.38));

window.addEventListener("keydown", (event) => {
  if (
    rewards.open ||
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

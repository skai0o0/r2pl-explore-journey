import { ColyseusSDK, type Room } from "@colyseus/sdk";
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
import { mountKnowledgePanel } from "./knowledgePanel.ts";
import {
  deriveDevCreditState,
  type PickedTile,
  WorldView,
} from "./worldView.ts";
import "./style.css";

const players = [
  { token: "dawn-one", label: "Dawn · Explorer 1", slot: 0 },
  { token: "dawn-two", label: "Dawn · Explorer 2", slot: 0 },
  { token: "dusk-one", label: "Dusk · Explorer 1", slot: 15 },
  { token: "dusk-two", label: "Dusk · Explorer 2", slot: 15 },
] as const;
type Player = (typeof players)[number];

interface Profile {
  name: string;
  schoolName: string;
  schoolSlot: number;
  balance: string;
  cost: string;
  fixtureOnly: true;
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

const integratedQa = await fetch("/api/qa/integrated-mode", {
  cache: "no-store",
})
  .then(
    async (response) => response.ok && (await response.json()).enabled === true,
  )
  .catch(() => false);
const sdk = new ColyseusSDK(`ws://${location.hostname}:2567`);
let player: Player =
  players.find(
    (item) => item.token === sessionStorage.getItem("r2pl-fixture-player"),
  ) ?? players[0]!;
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
const pending = new Map<string, PendingAction>();

function lacksTestCredits(): boolean {
  return deriveDevCreditState(profileBalance, profileCost) === "insufficient";
}

function showInsufficientCredits(): void {
  ui.explore.disabled = true;
  ui.explore.innerHTML =
    "<span>✦</span> Not enough test credits <small>Explore unavailable</small>";
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
        '<span class="spin">✦</span> Committing… <small>1 test credit</small>';
      ui.badge.textContent = "COMMITTING";
      ui.badge.className = "badge-tag committing";
      return;
    }
  }
}

function updateTile(): void {
  if (!selected) {
    ui.tile.textContent = "— / —";
    ui.knowledge.textContent = "Select a tile on the map";
    ui.badge.textContent = "IDLE";
    ui.badge.className = "badge-tag";
    ui.explore.disabled = true;
    ui.explore.innerHTML =
      "<span>✦</span> Explore tile <small>1 test credit</small>";
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
      '<span class="spin">✦</span> Committing… <small>1 test credit</small>';
    return;
  }

  // Check public fixtures
  if (selected.x === 215 && selected.z === 235) {
    ui.knowledge.textContent = "Dawn Headquarters · Public sanctuary fixture";
    ui.badge.textContent = "DAWN HQ";
    ui.badge.className = "badge-tag fixture";
  } else if (selected.x === 785 && selected.z === 765) {
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
        player.slot === 0
          ? "Dawn University territory · Authorized presence"
          : "Dusk University territory · Authorized presence";
      ui.badge.textContent = "OWNED";
      ui.badge.className = "badge-tag owned";
      ui.explore.disabled = true;
      ui.explore.innerHTML =
        "<span>✓</span> Already Explored <small>0 credits</small>";
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
          "<span>✦</span> Establish Knowledge <small>1 test credit</small>";
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
      "<span>✦</span> Explore tile <small>1 test credit</small>";
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
  try {
    const response = await fetch("/api/fixture/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Profile ${response.status}`);
    const profile = (await response.json()) as Profile;
    if (
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
    updateTile();
    document.body.dataset.school = player.slot === 0 ? "dawn" : "dusk";
  } catch {
    if (token === player.token)
      activity("Balance temporarily unavailable", "error");
  }
}

function refreshBalanceSoon(): void {
  window.clearTimeout(balanceTimer);
  balanceTimer = window.setTimeout(() => void refreshProfile(), 180);
}

const world = new WorldView(
  get("world-view"),
  (tile) => {
    selected = tile;
    updateTile();
    explore();
  },
  () => scheduleSubscribe(),
  (hovered) => {
    updateHover(hovered);
  },
);

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

if (integratedQa) void mountKnowledgePanel(world);

announceCameraMode(true);

function scheduleSubscribe(): void {
  window.clearTimeout(subscribeTimer);
  subscribeTimer = window.setTimeout(subscribeNow, 300);
}

function subscribeNow(): void {
  if (!room) return;
  const ids = world.visibleChunkIds(selected?.chunk);
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
  if (lacksTestCredits()) {
    showInsufficientCredits();
    activity("Not enough test credits to explore", "normal");
    return;
  }
  const key = crypto.getRandomValues(new Uint8Array(16));
  const action: PendingAction = {
    key: keyHex(key),
    frame: encodeExplore({ key, tileIndex: selected.index, ruleVersion: 0 }),
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
  profileBalance = undefined;
  profileCost = undefined;
  sessionStorage.setItem("r2pl-fixture-player", player.token);
  replica = new ProjectionReplica(player.slot);
  selected = undefined;
  world.setSchool(player.slot);
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
    activity(
      `Entered ${player.slot === 0 ? "Dawn" : "Dusk"} University world`,
      "success",
    );
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
  world.animateFocus(
    player.slot === 0 ? 215 : 785,
    player.slot === 0 ? 235 : 765,
    200,
  ),
);
get("landmark-button").addEventListener("click", () =>
  world.animateFocus(510, 485, 200),
);
overviewButton.addEventListener("click", () =>
  world.animateFocus(500, 500, 1000),
);
get("zoom-in").addEventListener("click", () => world.zoom(0.72));
get("zoom-out").addEventListener("click", () => world.zoom(1.38));

window.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLInputElement
  )
    return;
  switch (event.key) {
    case "h":
    case "H":
      world.animateFocus(
        player.slot === 0 ? 215 : 785,
        player.slot === 0 ? 235 : 765,
        200,
      );
      break;
    case "l":
    case "L":
      world.animateFocus(510, 485, 200);
      break;
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

import "./style.css";

interface Fixture {
  token: string;
  label: string;
  schoolSlot: number;
}
interface KnowledgeCase {
  caseId: string;
  status: string;
  revision: number;
  requiredPoints: string;
  receivedPoints: string;
  remainingPoints: string;
  rollingDeadlineMs: string;
  hardDeadlineMs: string;
}
interface QaState {
  campaignId: string;
  viewer: { label: string; schoolSlot: number };
  walletPoints: string;
  case: KnowledgeCase | null;
  tiles: { tileIndex: number; schoolSlots: number[] }[];
  scores: { schoolSlot: number; score: string }[];
  projectionPending: boolean;
  updatedAtMs: number;
}
interface Receipt {
  kind: string;
  reason: string;
  acceptedPoints: string;
  revision: number;
  status: string;
}
const get = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing QA element: ${id}`);
  return found as T;
};
const ui = {
  players: get<HTMLSelectElement>("player-select"),
  connection: get<HTMLElement>("connection"),
  live: get<HTMLElement>("live-dot"),
  viewer: get<HTMLElement>("viewer-label"),
  wallet: get<HTMLElement>("wallet-balance"),
  scenario: get<HTMLButtonElement>("scenario-button"),
  contribute: get<HTMLButtonElement>("contribute-button"),
  retry: get<HTMLButtonElement>("retry-button"),
  sync: get<HTMLButtonElement>("sync-button"),
  points: get<HTMLInputElement>("points-input"),
  phase: get<HTMLElement>("phase-tag"),
  phaseText: get<HTMLElement>("phase-text"),
  caseId: get<HTMLElement>("case-id"),
  caseStatus: get<HTMLElement>("case-status"),
  projection: get<HTMLElement>("projection-status"),
  score0: get<HTMLElement>("score-0"),
  score1: get<HTMLElement>("score-1"),
  progressLabel: get<HTMLElement>("progress-label"),
  progressFill: get<HTMLElement>("progress-fill"),
  remaining: get<HTMLElement>("remaining-points"),
  rolling: get<HTMLElement>("rolling-deadline"),
  hard: get<HTMLElement>("hard-deadline"),
  pins: get<HTMLElement>("tile-pins"),
  tileCount: get<HTMLElement>("tile-count"),
  tileSummary: get<HTMLElement>("tile-summary"),
  empty: get<HTMLElement>("empty-world"),
  updated: get<HTMLElement>("last-updated"),
  feed: get<HTMLOListElement>("activity-log"),
  error: get<HTMLElement>("error-box"),
};
let fixtures: Fixture[] = [];
let active: Fixture | undefined;
let current: QaState | undefined;
let lastPayment:
  | { token: string; caseId: string; contributionId: string; points: string }
  | undefined;
let busy = false;
let refreshBusy = false;
let generation = 0;
function event(
  message: string,
  level: "good" | "error" | "normal" = "normal",
): void {
  const row = document.createElement("li");
  row.className = level;
  const time = document.createElement("small");
  time.textContent = new Date().toLocaleTimeString();
  const content = document.createElement("span");
  content.textContent = message;
  row.append(time, content);
  ui.feed.prepend(row);
  while (ui.feed.children.length > 5) ui.feed.lastElementChild?.remove();
}
function error(message: string): void {
  ui.error.hidden = false;
  ui.error.textContent = message;
  event(message, "error");
}
function clearError(): void {
  ui.error.hidden = true;
  ui.error.textContent = "";
}
async function api<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  payload?: object,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method === "POST") headers["Content-Type"] = "application/json";
  if (token) headers["X-QA-Token"] = token;
  const response = await fetch(path, {
    method,
    headers,
    cache: "no-store",
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    let description = `Server returned ${String(response.status)}`;
    if (response.status === 401)
      description = "QA session unauthorized. Reload the page.";
    if (response.status === 403)
      description =
        "This action is not permitted for the selected synthetic school.";
    if (response.status === 409)
      description =
        "Command conflict: current case or retry key is no longer valid.";
    throw new Error(description);
  }
  return (await response.json()) as T;
}
function formatTime(value: string): string {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? new Date(num).toLocaleString() : "—";
}
function render(state: QaState): void {
  current = state;
  ui.live.classList.add("on");
  ui.connection.textContent = "LOCAL QA CONNECTED";
  ui.wallet.textContent = state.walletPoints;
  ui.viewer.textContent = `VERIFIED FIXTURE · SCHOOL ${state.viewer.schoolSlot}`;
  ui.score0.textContent =
    state.scores.find((x) => x.schoolSlot === 0)?.score ?? "0";
  ui.score1.textContent =
    state.scores.find((x) => x.schoolSlot === 1)?.score ?? "0";
  ui.projection.textContent = state.projectionPending
    ? "PENDING SYNC"
    : "IN SYNC";
  const info = state.case;
  ui.phase.textContent = info ? info.status.toUpperCase() : "AWAITING CASE";
  ui.phaseText.textContent = info
    ? `REVISION ${info.revision} · ${info.status.toUpperCase()}`
    : "Waiting for scenario";
  ui.caseId.textContent = info?.caseId ?? "Not created";
  ui.caseStatus.textContent = info?.status.toUpperCase() ?? "IDLE";
  ui.remaining.textContent = info?.remainingPoints ?? "—";
  ui.progressLabel.textContent = `${info?.receivedPoints ?? "0"} / ${info?.requiredPoints ?? "0"}`;
  const fee = Number(info?.requiredPoints ?? "0");
  const received = Number(info?.receivedPoints ?? "0");
  ui.progressFill.style.width = `${fee > 0 ? Math.min(100, Math.max(0, (100 * received) / fee)) : 0}%`;
  ui.rolling.textContent = formatTime(info?.rollingDeadlineMs ?? "");
  ui.hard.textContent = formatTime(info?.hardDeadlineMs ?? "");
  ui.tileCount.textContent = String(state.tiles.length);
  ui.tileSummary.textContent = state.tiles.length
    ? "Committed ownership projection"
    : "No ownership projection yet";
  ui.empty.hidden = state.tiles.length > 0;
  ui.pins.replaceChildren();
  for (const tile of state.tiles) {
    const pin = document.createElement("div");
    const ownership =
      tile.schoolSlots.length === 2
        ? "school-both"
        : tile.schoolSlots.length === 1
          ? `school-${tile.schoolSlots[0]}`
          : "unassigned";
    pin.className = `pin ${ownership}`;
    pin.style.left = `${2 + ((tile.tileIndex % 1000) / 1000) * 96}%`;
    pin.style.top = `${2 + (Math.floor(tile.tileIndex / 1000) / 1000) * 96}%`;
    pin.title =
      "Tile #" +
      tile.tileIndex +
      " · Schools " +
      (tile.schoolSlots.join(",") || "none");
    const label = document.createElement("b");
    label.textContent = tile.schoolSlots.length
      ? tile.schoolSlots.join("+")
      : "·";
    pin.append(label);
    ui.pins.append(pin);
  }
  ui.updated.textContent = `UPDATED ${new Date(state.updatedAtMs).toLocaleTimeString()}`;
  ui.scenario.disabled =
    busy || !active || active.schoolSlot !== 0 || info?.status === "claiming";
  ui.contribute.disabled =
    busy ||
    !active ||
    active.schoolSlot !== 1 ||
    !info ||
    info.status !== "claiming";
  ui.retry.disabled =
    busy || !active || !lastPayment || lastPayment.token !== active.token;
  ui.sync.disabled = busy || !active;
}
function disconnect(): void {
  ui.live.classList.remove("on");
  ui.connection.textContent = "QA SERVER DISCONNECTED";
}
async function refresh(): Promise<void> {
  if (!active || busy || refreshBusy) return;
  refreshBusy = true;
  const seq = ++generation;
  const token = active.token;
  try {
    const state = await api<QaState>("/api/qa/state", "GET", undefined, token);
    if (seq === generation && active.token === token) render(state);
  } catch {
    disconnect();
  } finally {
    refreshBusy = false;
  }
}
async function command(
  run: () => Promise<{ state: QaState; receipt?: Receipt } | QaState>,
  label: string,
): Promise<void> {
  if (!active || busy) return;
  busy = true;
  clearError();
  if (current) render(current);
  const token = active.token;
  try {
    const result = await run();
    const next = "state" in result ? result.state : result;
    if (active?.token === token) render(next);
    const receipt = "receipt" in result ? result.receipt : undefined;
    if (receipt?.kind === "reject") {
      error(`${label} rejected: ${receipt.reason}`);
    } else
      event(
        label + (receipt ? ` · ${receipt.kind} / ${receipt.reason}` : ""),
        "good",
      );
  } catch (caught) {
    error(caught instanceof Error ? caught.message : "QA command failed");
  } finally {
    busy = false;
    if (current) render(current);
  }
}
ui.players.addEventListener("change", () => {
  const selected = fixtures.find((item) => item.token === ui.players.value);
  if (!selected) return;
  active = selected;
  generation++;
  current = undefined;
  lastPayment = undefined;
  ui.wallet.textContent = "—";
  ui.viewer.textContent = "SWITCHING VERIFIED QA FIXTURE";
  event(`Switched to ${selected.label}`);
  void refresh();
});
ui.scenario.addEventListener("click", () => {
  if (!active) return;
  const token = active.token;
  void command(
    () =>
      api<{ state: QaState; receipt: Receipt }>(
        "/api/qa/scenario/start",
        "POST",
        {},
        token,
      ),
    "Synthetic succession started",
  );
});
ui.contribute.addEventListener("click", () => {
  if (!active || !current?.case) return;
  const points = ui.points.value.trim();
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(points)) {
    error("Choose an integer between 1 and 50.");
    return;
  }
  const attempt = {
    token: active.token,
    caseId: current.case.caseId,
    contributionId: crypto.randomUUID(),
    points,
  };
  lastPayment = attempt;
  void command(
    () =>
      api<{ state: QaState; receipt: Receipt }>(
        "/api/qa/knowledge/contribute",
        "POST",
        {
          caseId: attempt.caseId,
          contributionId: attempt.contributionId,
          points: attempt.points,
        },
        attempt.token,
      ),
    `Contribution ${points} Point(s)`,
  );
});
ui.retry.addEventListener("click", () => {
  const attempt = lastPayment;
  if (!attempt || !active || attempt.token !== active.token) return;
  void command(
    () =>
      api<{ state: QaState; receipt: Receipt }>(
        "/api/qa/knowledge/contribute",
        "POST",
        {
          caseId: attempt.caseId,
          contributionId: attempt.contributionId,
          points: attempt.points,
        },
        attempt.token,
      ),
    "Replayed the identical contribution ID",
  );
});
ui.sync.addEventListener("click", () => {
  if (!active) return;
  const token = active.token;
  void command(
    () => api<QaState>("/api/qa/sync", "POST", {}, token),
    "Synchronized committed ownership and deadline",
  );
});
async function bootstrap(): Promise<void> {
  try {
    const result = await api<{ fixtures: Fixture[] }>("/api/qa/fixtures");
    if (!Array.isArray(result.fixtures) || result.fixtures.length !== 2)
      throw new Error("Invalid synthetic QA fixture registry");
    fixtures = result.fixtures;
    ui.players.replaceChildren();
    for (const fixture of fixtures) {
      const option = document.createElement("option");
      option.value = fixture.token;
      option.textContent = fixture.label;
      ui.players.append(option);
    }
    active = fixtures[0];
    ui.players.value = active.token;
    event("Connected to localhost synthetic QA fixture");
    await refresh();
  } catch (caught) {
    disconnect();
    error(
      caught instanceof Error
        ? caught.message
        : "Unable to connect to QA server",
    );
  }
}
window.setInterval(() => {
  void refresh();
}, 2000);
void bootstrap();

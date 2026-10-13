import type { QaStateV1 } from "../../server/qa/KnowledgeQaGatewayV1.ts";
import { boundedKnowledgeMarkers, type WorldView } from "./worldView.ts";

let mounted = false;

/** In-memory tokens only; this panel is mounted solely by the opt-in launcher. */
export async function mountKnowledgePanel(
  world: WorldView,
  selectedTileIndex: () => number | undefined,
): Promise<void> {
  if (mounted) return;
  mounted = true;
  const get = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(`qa-${id}`);
    if (!element) throw new Error("Missing Knowledge QA element");
    return element as T;
  };
  const panel = document.getElementById("knowledge-panel")!;
  const select = get<HTMLSelectElement>("player");
  const start = get<HTMLButtonElement>("start");
  const contribute = get<HTMLButtonElement>("contribute");
  const retry = get<HTMLButtonElement>("retry");
  const sync = get<HTMLButtonElement>("sync");
  const explore = get<HTMLButtonElement>("explore");
  const exploreRetry = get<HTMLButtonElement>("explore-retry");
  const points = get<HTMLInputElement>("points");
  let active: { token: string; schoolSlot: number } | undefined;
  let current: QaStateV1 | undefined;
  let last:
    | { caseId: string; contributionId: string; points: string }
    | undefined;
  let exploreEnabled = false;
  let lastExplore: { commandId: string; tileIndex: number } | undefined;
  let generation = 0;
  let busy = false;
  let polling = false;
  let stopped = false;
  let timer: number | undefined;
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      generation++;
      window.clearInterval(timer);
      world.setKnowledgeQaOverlay([]);
    },
    { once: true },
  );
  const event = (message: string): void => {
    get("status").textContent = message;
    const row = document.createElement("li");
    row.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    get("events").prepend(row);
    while (get("events").children.length > 5)
      get("events").lastElementChild?.remove();
  };
  const api = async <T>(path: string, payload?: object): Promise<T> => {
    const response = await fetch(path, {
      method: payload ? "POST" : "GET",
      cache: "no-store",
      headers: {
        ...(active ? { "X-QA-Token": active.token } : {}),
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`QA request failed (${response.status})`);
    return response.json() as Promise<T>;
  };
  const controls = (): void => {
    select.disabled = busy;
    start.disabled =
      busy ||
      !active ||
      active.schoolSlot !== 0 ||
      current?.case?.status === "claiming";
    contribute.disabled =
      busy || active?.schoolSlot !== 1 || current?.case?.status !== "claiming";
    retry.disabled = busy || !last || active?.schoolSlot !== 1;
    sync.disabled = busy || !active;
    const picked = selectedTileIndex();
    const legal =
      picked !== undefined &&
      Number.isInteger(picked) &&
      picked >= 0 &&
      picked < 1_000_000;
    explore.disabled = busy || !active || !exploreEnabled || !legal;
    explore.textContent = legal
      ? "Explore selected QA tile #" + picked + " · 1 Point"
      : "Select an isometric tile for Knowledge · 1 Point";
    exploreRetry.disabled = busy || !active || !exploreEnabled || !lastExplore;
  };
  const render = (state: QaStateV1): void => {
    current = state;
    get("wallet").textContent = `Personal Points: ${state.walletPoints}`;
    const c = state.case;
    get("case").textContent = c
      ? `${c.status} / revision ${c.revision}: ${c.receivedPoints}/${c.requiredPoints} Points (${c.remainingPoints} remaining)`
      : "No synthetic case";
    get("deadlines").textContent = c
      ? `Rolling: ${new Date(Number(c.rollingDeadlineMs)).toLocaleString()} | Hard: ${new Date(Number(c.hardDeadlineMs)).toLocaleString()}`
      : "";
    get("scores").textContent =
      `Knowledge projection scores: ${state.scores.map((s) => `School ${s.schoolSlot}: ${s.score}`).join(" | ")} / ${state.projectionPending ? "pending projection" : "synced"}`;
    const markers = boundedKnowledgeMarkers(state.tiles);
    world.setKnowledgeQaOverlay(markers);
    get("overlay-count").textContent =
      `${markers.length} of ${state.tiles.length} reported tiles shown (maximum 48). Purple rings: separate read-only QA overlay.`;
    get("tiles").replaceChildren();
    for (const marker of markers) {
      const row = document.createElement("li");
      const focus = document.createElement("button");
      focus.type = "button";
      focus.textContent = marker.title;
      focus.title =
        "Focus read-only QA marker; does not select or explore an M3 tile";
      focus.onclick = () =>
        world.animateFocus(
          marker.tileIndex % 1000,
          Math.floor(marker.tileIndex / 1000),
          32,
        );
      row.append(focus);
      get("tiles").append(row);
    }
    controls();
  };
  const refresh = async (): Promise<void> => {
    if (!active || busy || polling || stopped || document.hidden) return;
    polling = true;
    const seq = generation;
    try {
      const state = await api<QaStateV1>("/api/qa/state");
      if (seq === generation && !stopped) {
        render(state);
        get("status").textContent = "QA connected";
      }
    } catch {
      if (seq === generation && !stopped)
        get("status").textContent = "QA disconnected; retrying state poll";
    } finally {
      polling = false;
    }
  };
  const command = async (path: string, payload: object): Promise<void> => {
    if (!active || busy) return;
    busy = true;
    const seq = ++generation;
    controls();
    try {
      const result = await api<
        | QaStateV1
        | { state: QaStateV1; receipt: { kind: string; reason: string } }
      >(path, payload);
      if (seq !== generation || stopped) return;
      render("state" in result ? result.state : result);
      event(
        "receipt" in result
          ? `${result.receipt.kind}: ${result.receipt.reason}`
          : "Projection synchronized",
      );
    } catch (error) {
      if (!stopped)
        event(error instanceof Error ? error.message : "QA command failed");
    } finally {
      busy = false;
      controls();
    }
  };
  window.addEventListener("r2pl:selected-tile", controls);
  start.onclick = () => void command("/api/qa/scenario/start", {});
  contribute.onclick = () => {
    if (!current?.case || busy || active?.schoolSlot !== 1) return;
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(points.value)) {
      event("Enter 1 to 50 integer Points");
      return;
    }
    last = {
      caseId: current.case.caseId,
      contributionId: crypto.randomUUID(),
      points: points.value,
    };
    void command("/api/qa/knowledge/contribute", last);
  };
  retry.onclick = () => {
    if (last) void command("/api/qa/knowledge/contribute", last);
  };
  sync.onclick = () => void command("/api/qa/sync", {});
  explore.onclick = () => {
    const tileIndex = selectedTileIndex();
    if (
      tileIndex === undefined ||
      !Number.isInteger(tileIndex) ||
      tileIndex < 0 ||
      tileIndex >= 1_000_000
    ) {
      event("Choose an isometric tile before exploring Knowledge");
      return;
    }
    lastExplore = { commandId: crypto.randomUUID(), tileIndex };
    controls();
    void command("/api/qa/knowledge/explore", lastExplore);
  };
  exploreRetry.onclick = () => {
    if (lastExplore) void command("/api/qa/knowledge/explore", lastExplore);
  };
  try {
    const { fixtures } = await api<{
      fixtures: { token: string; label: string; schoolSlot: number }[];
    }>("/api/qa/fixtures");
    if (stopped) return;
    if (fixtures.length !== 2 || fixtures.some((f, i) => f.schoolSlot !== i))
      throw new Error("Invalid QA fixtures");
    for (const fixture of fixtures) {
      const option = document.createElement("option");
      option.value = fixture.token;
      option.textContent = fixture.label;
      select.append(option);
    }
    const mode = await api<{ exploreEnabled?: boolean }>(
      "/api/qa/integrated-mode",
    );
    exploreEnabled = mode.exploreEnabled === true;
    explore.hidden = !exploreEnabled;
    exploreRetry.hidden = !exploreEnabled;
    active = fixtures[0];
    select.onchange = () => {
      active = fixtures.find((f) => f.token === select.value);
      generation++;
      current = undefined;
      last = undefined;
      lastExplore = undefined;
      get("wallet").textContent = "Personal Points: loading";
      get("events").replaceChildren();
      get("case").textContent = "Loading selected identity";
      world.setKnowledgeQaOverlay([]);
      controls();
      void refresh();
    };
    panel.hidden = false;
    await refresh();
    if (!stopped) timer = window.setInterval(() => void refresh(), 2000);
  } catch {
    panel.hidden = false;
    event("Cannot initialize synthetic QA panel");
  }
}

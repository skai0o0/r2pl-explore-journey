import { SCENE_PRESENTATION } from "./scenePresentation.ts";

const config = SCENE_PRESENTATION.atmosphere;
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  hourCycle: "h23",
});

export function ambientPeriod(now: Date): "day" | "night" {
  const hour = Number(hourFormat.format(now));
  return hour >= config.dayStartHour && hour < config.nightStartHour
    ? "day"
    : "night";
}

/** Screen-space decoration; never participates in world state or picking. */
export function mountAmbientOverlay(host: HTMLElement): () => void {
  const layer = document.createElement("div");
  layer.className = "map-atmosphere";
  layer.setAttribute("aria-hidden", "true");
  const light = document.createElement("div");
  light.className = "map-atmosphere-light";
  layer.append(light);
  for (let i = 0; i < config.leaves; i++) {
    const leaf = document.createElement("span");
    leaf.className = "map-atmosphere-leaf";
    layer.append(leaf);
  }
  for (let i = 0; i < config.tumbleweeds; i++) {
    const bush = document.createElement("span");
    bush.className = "map-atmosphere-tumbleweed";
    bush.dataset.variant = String(i);
    const sprite = document.createElement("img");
    sprite.src = "/effects/tumbleweed.svg";
    sprite.alt = "";
    sprite.draggable = false;
    sprite.width = 40;
    sprite.height = 40;
    bush.append(sprite);
    layer.append(bush);
  }
  host.append(layer);
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    layer.dataset.period = ambientPeriod(new Date());
  };
  const visibility = () => {
    clearInterval(timer);
    timer = undefined;
    layer.dataset.paused = String(document.hidden);
    if (!document.hidden) {
      update();
      timer = setInterval(update, config.clockCheckMs);
    }
  };
  update();
  visibility();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
    layer.remove();
  };
}

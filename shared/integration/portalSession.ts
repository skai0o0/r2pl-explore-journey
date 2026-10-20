import { headquartersTiles } from "../gameplay/expansion.ts";
import { type DevSessionConfig, parseDevSession } from "./devSession.ts";

export interface PortalSessionConfig
  extends Omit<DevSessionConfig, "fixtureOnly"> {
  readonly mode: "portal";
  readonly fixtureOnly: false;
  readonly websocketUrl: string;
  readonly csrfToken: string;
  readonly testProfiles?: true;
}
export function parsePortalSession(input: unknown): PortalSessionConfig {
  if (!input || typeof input !== "object")
    throw new TypeError("Invalid portal session");
  const value = input as Record<string, unknown>;
  if (
    value.mode !== "portal" ||
    value.fixtureOnly !== false ||
    value.adjacentOnly !== true ||
    !Array.isArray(value.players) ||
    value.players.length !== 1 ||
    !Array.isArray(value.headquarters) ||
    value.headquarters.length !== 8 ||
    typeof value.websocketUrl !== "string" ||
    typeof value.csrfToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.csrfToken)
  )
    throw new TypeError("Invalid portal bootstrap");
  const parsed = parseDevSession({
    ...value,
    fixtureOnly: true,
    adjacentOnly: undefined,
    headquarters: undefined,
  });
  const url = new URL(value.websocketUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "wss:" ||
      (url.protocol === "ws:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw new TypeError("Invalid portal websocket URL");
  const occupied = new Set<number>(),
    slots = new Set<number>();
  const headquarters = value.headquarters.map((raw) => {
    const area = raw as NonNullable<DevSessionConfig["headquarters"]>[number];
    const tiles = headquartersTiles(area);
    if (
      area.schoolSlot < 0 ||
      area.schoolSlot > 7 ||
      slots.has(area.schoolSlot)
    )
      throw new TypeError("Invalid portal school");
    slots.add(area.schoolSlot);
    for (const tile of tiles) {
      if (occupied.has(tile)) throw new TypeError("Overlapping portal HQs");
      occupied.add(tile);
    }
    return { ...area };
  });
  return {
    ...parsed,
    mode: "portal",
    fixtureOnly: false,
    websocketUrl: url.href,
    csrfToken: value.csrfToken,
    ...(value.testProfiles === true ? { testProfiles: true as const } : {}),
    adjacentOnly: true,
    headquarters,
  };
}

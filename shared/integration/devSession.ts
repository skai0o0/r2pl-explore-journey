/** Local development bootstrap only. Never accepts production identity or wallet authority. */
import { tileIndex } from "../world/coordinates.ts";
export interface DevPlayer {
  readonly token: string;
  readonly label: string;
  readonly schoolName: string;
  readonly slot: number;
  readonly home: { readonly x: number; readonly z: number };
}
export interface DevSessionConfig {
  readonly fixtureOnly: true;
  readonly version: 1;
  readonly websocketPort: number;
  readonly players: readonly DevPlayer[];
}
export function parseDevSession(input: unknown): DevSessionConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid dev session");
  const value = input as Record<string, unknown>;
  if (
    value.fixtureOnly !== true ||
    value.version !== 1 ||
    !Number.isInteger(value.websocketPort) ||
    Number(value.websocketPort) < 1 ||
    Number(value.websocketPort) > 65535 ||
    !Array.isArray(value.players) ||
    value.players.length < 1 ||
    value.players.length > 64
  )
    throw new RangeError("Invalid synthetic bootstrap");
  const tokens = new Set<string>();
  const players = value.players.map((raw: unknown): DevPlayer => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new TypeError("Invalid player");
    const player = raw as Record<string, unknown>;
    if (
      typeof player.token !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(player.token) ||
      tokens.has(player.token) ||
      typeof player.label !== "string" ||
      player.label.length < 1 ||
      player.label.length > 100 ||
      typeof player.schoolName !== "string" ||
      player.schoolName.length < 1 ||
      player.schoolName.length > 100 ||
      !Number.isInteger(player.slot) ||
      Number(player.slot) < 0 ||
      Number(player.slot) > 15 ||
      !player.home ||
      typeof player.home !== "object" ||
      Array.isArray(player.home)
    )
      throw new RangeError("Invalid synthetic player");
    const home = player.home as Record<string, unknown>;
    tileIndex(Number(home.x), Number(home.z));
    if (typeof home.x !== "number" || typeof home.z !== "number")
      throw new RangeError("Invalid player home");
    tokens.add(player.token);
    return {
      token: player.token,
      label: player.label,
      schoolName: player.schoolName,
      slot: Number(player.slot),
      home: { x: home.x, z: home.z },
    };
  });
  return {
    fixtureOnly: true,
    version: 1,
    websocketPort: Number(value.websocketPort),
    players,
  };
}
export const LEGACY_DEV_SESSION: DevSessionConfig = {
  fixtureOnly: true,
  version: 1,
  websocketPort: 2567,
  players: [
    {
      token: "dawn-one",
      label: "Dawn · Explorer 1",
      schoolName: "Dawn University",
      slot: 0,
      home: { x: 215, z: 235 },
    },
    {
      token: "dawn-two",
      label: "Dawn · Explorer 2",
      schoolName: "Dawn University",
      slot: 0,
      home: { x: 215, z: 235 },
    },
    {
      token: "dusk-one",
      label: "Dusk · Explorer 1",
      schoolName: "Dusk University",
      slot: 15,
      home: { x: 785, z: 765 },
    },
    {
      token: "dusk-two",
      label: "Dusk · Explorer 2",
      schoolName: "Dusk University",
      slot: 15,
      home: { x: 785, z: 765 },
    },
  ],
};

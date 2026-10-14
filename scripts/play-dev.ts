import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_CONFIG,
  LANDMARKS,
  NEUTRAL_CHESTS,
  SCHOOLS,
  STAGING_OBJECTS,
} from "../shared/gameplay/gameConfig.ts";
import { headquartersTiles } from "../shared/gameplay/expansion.ts";
import { tileCoordinates } from "../shared/world/coordinates.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { WorldState } from "../shared/world/world.ts";
import { createSyntheticServer } from "../server/realtime/bootstrap.ts";
import { schoolPlayLayout } from "../server/integration/SchoolHeadquarters.ts";

const { schools, headquarters } = schoolPlayLayout();
const registry = new SchoolRegistry(
  SCHOOLS.map((s) => ({ id: s.id, slot: s.slot })),
);

// Create players (2 humans + 3 bots per school = 40 actors)
const actorsPerSchool = 5;
const actors: {
  token: string;
  actorId: string;
  schoolSlot: number;
  name: string;
  schoolName: string;
  role: string;
}[] = [];
const players: {
  token: string;
  label: string;
  schoolName: string;
  slot: number;
  home: { x: number; z: number };
}[] = [];

for (const school of schools) {
  for (let n = 0; n < actorsPerSchool; n++) {
    const role = n < 2 ? "human" : "bot";
    const token = `dev-school-${school.slot}-actor-${n}`;
    const actorId = `93000000-0000-4000-8000-${String(
      school.slot * actorsPerSchool + n + 1,
    ).padStart(12, "0")}`;
    const name = `${school.label} · ${role === "human" ? "Explorer" : "Bot"} ${
      n + 1
    }`;
    actors.push({
      token,
      actorId,
      schoolSlot: school.slot,
      name,
      schoolName: school.label,
      role,
    });
    if (role === "human") {
      players.push({
        token,
        label: name,
        schoolName: school.label,
        slot: school.slot,
        home: tileCoordinates(school.home),
      });
    }
  }
}

// Initialize in-memory WorldState with 400 HQ tiles + revealed fog per school
const world = new WorldState(registry);
for (const hq of headquarters) {
  const tiles = headquartersTiles(hq);
  for (const tile of tiles) {
    world.setPresence(tile, hq.schoolSlot, true);
    world.reveal(tile, hq.schoolSlot);
  }
}

// Start Colyseus WebSocket Server on 2568
const wsPort = Number(process.env.WS_PORT ?? 2568);
const synthetic = createSyntheticServer(registry, actors, {
  fanoutMode: "indexed",
});
// Override synthetic server's world with pre-seeded HQ world
(synthetic.core as unknown as { world: WorldState }).world = world;
await synthetic.server.listen(wsPort, "127.0.0.1");

// Balances and inventory per actor
const balances = new Map<string, number>();
for (const a of actors) {
  balances.set(a.token, 1000);
}

// HTTP API Server on 4176
const httpPort = Number(process.env.PORT ?? 4176);
const clientRoot = resolve(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
};

const http = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    response.writeHead(400).end();
    return;
  }

  const path = url.pathname;
  const token = request.headers.authorization?.replace(/^Bearer /, "");

  const json = (data: unknown, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
  };

  if (path === "/api/fixture/bootstrap") {
    json({
      fixtureOnly: true,
      version: 1,
      websocketPort: wsPort,
      players,
      campaignId: "98000000-0000-4000-8000-000000000000",
      adjacentOnly: true,
      headquarters,
    });
    return;
  }

  if (path === "/api/fixture/world") {
    json({
      ruleVersion: GAME_CONFIG.ruleVersion,
      objects: STAGING_OBJECTS,
    });
    return;
  }

  if (path === "/api/fixture/chests") {
    json({
      ruleVersion: GAME_CONFIG.ruleVersion,
      objects: NEUTRAL_CHESTS,
    });
    return;
  }

  if (path === "/api/fixture/me") {
    const actor = actors.find((a) => a.token === token) ?? actors[0]!;
    json({
      name: actor.name,
      schoolName: actor.schoolName,
      schoolSlot: actor.schoolSlot,
      balance: String(balances.get(actor.token) ?? 1000),
      cost: "1",
      fixtureOnly: true,
      inventory: {
        crystals: "1000",
        keys: "1",
      },
    });
    return;
  }

  if (path === "/api/fixture/receipts") {
    json({
      fixtureOnly: true,
      receipts: [],
    });
    return;
  }

  if (path === "/api/game/ranking") {
    json({
      rankings: SCHOOLS.map((s) => ({
        schoolId: s.id,
        schoolSlot: s.slot,
        points: 400,
        score: 400,
        timestamp: Date.now(),
      })),
    });
    return;
  }

  if (path === "/api/models/manifest") {
    json({
      models: [
        "/models/hqs/hcmut_hq.glb",
        "/models/hqs/hcmiu_hq.glb",
      ],
    });
    return;
  }

  if (path === "/api/game") {
    if (request.method === "POST") {
      json({
        status: "applied",
        reason: null,
        message: "Thao tác thành công",
      });
      return;
    }
    json({
      ruleVersion: 1,
      runningMode: "synthetic",
      crystals: "1000",
      treasureMaps: "5",
      revealedTiles: 400,
      weeklyKm: 5.2,
      gifts: [],
      keys: {
        aspire: "2",
        nitro: "1",
        predator: "1",
      },
      landmarks: LANDMARKS.map((l) => ({
        id: l.id,
        holder: null,
        target: 500,
        pot: 0,
        solved: false,
        cooldownUntil: 0,
        hasPath: true,
      })),
      chests: NEUTRAL_CHESTS,
      cooldowns: {},
      shared: [],
      events: [],
    });
    return;
  }

  if (path === "/health") {
    json({ status: "ok", schools: 8, wsPort, httpPort });
    return;
  }

  // Try serving static files from dist/client
  try {
    const filePath = resolve(
      clientRoot,
      path === "/" ? "index.html" : path.replace(/^\//, ""),
    );
    if (filePath.startsWith(clientRoot)) {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      response.writeHead(200, {
        "Content-Type": mime[ext] ?? "application/octet-stream",
      });
      response.end(content);
      return;
    }
  } catch {
    // Fallback 404
  }

  response.writeHead(404).end();
});

http.listen(httpPort, "127.0.0.1", () => {
  console.log(`[R2PL Dev] HTTP/API Server: http://127.0.0.1:${httpPort}`);
  console.log(`[R2PL Dev] Colyseus WebSocket: ws://127.0.0.1:${wsPort}`);
  console.log(`[R2PL Dev] 8 Schools initialized with 400 HQ tiles each.`);
});

const stop = async () => {
  http.close();
  await synthetic.server.transport.shutdown();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  connect,
  type ClientHttp2Session,
  type IncomingHttpHeaders,
} from "node:http2";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { GAME_CONFIG, SCHOOLS } from "../shared/gameplay/gameConfig.ts";
import type { HeadquartersArea } from "../shared/gameplay/expansion.ts";
import type { BotSchool, BotRole } from "../shared/simulation/schoolBots.ts";
import { tileIndex } from "../shared/world/coordinates.ts";
import { BotPeer, pause } from "./simulation/BotPeer.ts";
import { latencySummary } from "./simulation/report.ts";

// Network clients only: no DB credentials, local server, or server-side /bots/start.
// Synthetic identities match SchoolPlayFixture; they cannot authenticate in portal mode.
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key!, value.join("=")];
  }),
);
if (args.has("help")) {
  console.log(
    "npm run simulate:public -- --count=200 --duration=60 --ramp=30 --assets=none\nOnly https://play.skai0o0.id.vn is supported. count 1..200, duration 1..600s after ramp. assets=none|shell (HTML + entry JS/CSS only, excludes 3D models). Results: artifacts/public-clients/*.json. Ctrl+C closes all clients.",
  );
  process.exit(0);
}
for (const key of args.keys())
  if (!["count", "duration", "ramp", "assets", "host"].includes(key))
    throw new Error(`Unknown option: ${key}; use --name=value`);
function integer(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be ${min}..${max}`);
  return value;
}
const count = integer("count", 200, 1, 200);
const duration = integer("duration", 60, 1, 600);
const ramp = integer("ramp", 30, 1, 120);
const assets = args.get("assets") ?? "none";
if (!["none", "shell"].includes(assets))
  throw new RangeError("assets must be none|shell");
const origin = new URL(args.get("host") ?? "https://play.skai0o0.id.vn");
if (
  origin.origin !== "https://play.skai0o0.id.vn" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error(
    "This runner targets only the public synthetic Demo, never Production",
  );
let stop = false;
process.once("SIGINT", () => {
  stop = true;
});
process.once("SIGTERM", () => {
  stop = true;
});
const peers: BotPeer[] = [];
const connectedPeers = new Set<BotPeer>();
const failures: Record<string, number> = {};
const http = {
  protocol: "h2",
  requests: 0,
  errors: 0,
  encodedBodyBytes: 0,
  decodedBodyBytes: 0,
  contentLengthBytes: 0,
  responsesWithContentLength: 0,
  latencyMs: [] as number[],
  statuses: {} as Record<number, number>,
};
const httpSessions = new Map<string, ClientHttp2Session>();
const fail = (code: string) => {
  failures[code] = (failures[code] ?? 0) + 1;
};
async function request(path: string, token?: string): Promise<string> {
  const started = performance.now();
  http.requests++;
  try {
    const sessionKey = token ?? "control";
    let session = httpSessions.get(sessionKey);
    if (!session || session.closed || session.destroyed) {
      session = connect(origin.origin);
      session.on("error", () => {});
      httpSessions.set(sessionKey, session);
    }
    const response = await new Promise<{
      headers: IncomingHttpHeaders;
      body: Buffer;
    }>((resolve, reject) => {
      const stream = session!.request(
        {
          ":method": "GET",
          ":path": path,
          "accept-encoding": "br, gzip",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        { signal: AbortSignal.timeout(12000) },
      );
      let headers: IncomingHttpHeaders = {};
      const parts: Buffer[] = [];
      stream.on("response", (value) => {
        headers = value;
      });
      stream.on("data", (part: Buffer) => {
        parts.push(part);
        http.encodedBodyBytes += part.length;
      });
      stream.on("error", reject);
      stream.on("end", () => resolve({ headers, body: Buffer.concat(parts) }));
      stream.end();
    });
    const encoding = response.headers["content-encoding"];
    const body = (
      encoding === "br"
        ? brotliDecompressSync(response.body)
        : encoding === "gzip"
          ? gunzipSync(response.body)
          : response.body
    ).toString("utf8");
    http.decodedBodyBytes += Buffer.byteLength(body);
    const length = response.headers["content-length"];
    if (length !== undefined) {
      http.responsesWithContentLength++;
      http.contentLengthBytes += Number(length);
    }
    const status = Number(response.headers[":status"]);
    http.statuses[status] = (http.statuses[status] ?? 0) + 1;
    if (status < 200 || status >= 300) throw new Error(`HTTP_${status}`);
    return body;
  } catch (error) {
    http.errors++;
    fail(
      error instanceof Error && /^HTTP_\d+$/.test(error.message)
        ? error.message
        : "HTTP_TRANSPORT_OR_TIMEOUT",
    );
    throw new Error("Public HTTP request failed (see status counters)");
  } finally {
    http.latencyMs.push(performance.now() - started);
  }
}
const startedAt = performance.now();
let steadyStartedAt: number | undefined;
let steadyBaseline:
  | { rx: number; tx: number; http: number; httpEncoded: number }
  | undefined;
let completedAt: number | undefined;
let connected = 0;
const totals = () => ({
  rx: peers.reduce((n, p) => n + p.bytes, 0),
  tx: peers.reduce((n, p) => n + p.sentBytes, 0),
  http: http.decodedBodyBytes,
  httpEncoded: http.encodedBodyBytes,
});
const progress = () => ({
  connected,
  healthy: peers.filter((p) => connectedPeers.has(p) && !p.error).length,
  applied: peers.reduce((n, p) => n + p.applied, 0),
  noChange: peers.reduce((n, p) => n + p.noChange, 0),
  rejected: peers.reduce((n, p) => n + p.rejected, 0),
  wsReceivedMB: Number((totals().rx / 1e6).toFixed(2)),
  httpErrors: http.errors,
});
let ticker: NodeJS.Timeout | undefined;
let previousTick = performance.now();
const timerSlipMs: number[] = [];
try {
  const bootstrap = JSON.parse(await request("/api/fixture/bootstrap")) as {
    fixtureOnly?: boolean;
    campaignId?: string;
    websocketUrl?: string;
    players: { slot: number; home: { x: number; z: number } }[];
    headquarters: HeadquartersArea[];
  };
  if (
    bootstrap.fixtureOnly !== true ||
    bootstrap.campaignId !== "98000000-0000-4000-8000-000000000000"
  )
    throw new Error("Refusing a non-synthetic or unfamiliar campaign");
  const existing = JSON.parse(await request("/api/fixture/bots")) as {
    status: string;
  };
  if (["running", "starting", "stopping"].includes(existing.status))
    throw new Error(
      "Stop the in-game server bots first; these clients use the same synthetic actors",
    );
  const endpoint = new URL(
    bootstrap.websocketUrl ?? origin.origin.replace("https:", "wss:"),
  );
  if (
    endpoint.protocol !== "wss:" ||
    endpoint.host !== origin.host ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error(
      "Refusing a WebSocket endpoint that bypasses the public Demo domain",
    );
  const schools: BotSchool[] = SCHOOLS.map((school) => {
    const home = bootstrap.players.find((p) => p.slot === school.slot)?.home;
    if (!home) throw new Error("Incomplete synthetic school roster");
    return {
      slot: school.slot,
      fixtureId: school.id,
      label: school.shortName,
      color: school.color,
      home: tileIndex(home.x, home.z),
      meeting: tileIndex(home.x + 60, home.z),
      region: { x: home.x - 128, z: home.z - 128, size: 256 },
      protectedHeadquarters: bootstrap.headquarters,
    };
  });
  console.log(
    `Public Demo: ${count} independent WSS clients, ramp ${ramp}s, then play ${duration}s. assets=${assets}`,
  );
  previousTick = performance.now();
  ticker = setInterval(() => {
    const now = performance.now();
    timerSlipMs.push(Math.max(0, now - previousTick - 5000));
    previousTick = now;
    console.log(JSON.stringify(progress()));
  }, 5000);
  let releasePlay!: () => void;
  const readyToPlay = new Promise<void>((resolve) => {
    releasePlay = resolve;
  });
  const rampStart = performance.now();
  const workers: Promise<void>[] = [];
  const startups: Promise<void>[] = [];
  for (let i = 0; i < count && !stop; i++) {
    const slot = i % schools.length,
      ordinal = 2 + Math.floor(i / schools.length);
    const school = schools[slot]!;
    const token = `dev-school-${slot}-actor-${ordinal}`;
    const role: BotRole = (["explorer", "connector", "steward"] as const)[
      ordinal % 3
    ]!;
    const peer = new BotPeer(
      endpoint.href,
      token,
      school,
      role,
      (20261019 ^ i) >>> 0,
    );
    peers.push(peer);
    let startupDone!: () => void;
    startups.push(
      new Promise<void>((resolve) => {
        startupDone = resolve;
      }),
    );
    workers.push(
      (async () => {
        try {
          // Establish the browser-like HTTP/2 session during ramp, not a burst of
          // new TLS connections when every client begins its first polling tick.
          await request("/api/fixture/me", token);
          if (assets === "shell") {
            const html = await request("/");
            const paths = [
              ...new Set(
                [
                  ...html.matchAll(
                    /(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g,
                  ),
                ].map((m) => m[1]!),
              ),
            ];
            if (!paths.length) throw new Error("Missing client entry assets");
            for (const path of paths) await request(path);
          }
          await peer.connect();
          connected++;
          connectedPeers.add(peer);
          startupDone();
          await readyToPlay;
          let profileDue = 0,
            worldDue = 0,
            gameDue = 0,
            rankingDue = 0,
            botsDue = 0;
          while (
            !stop &&
            performance.now() < steadyStartedAt! + duration * 1000 &&
            !peer.error
          ) {
            const now = performance.now();
            const polls: Promise<unknown>[] = [];
            if (now >= profileDue) {
              profileDue = now + GAME_CONFIG.integration.profileRefreshMs;
              polls.push(request("/api/fixture/me", token));
            }
            if (now >= worldDue) {
              worldDue = now + GAME_CONFIG.editor.pollMs;
              polls.push(request("/api/fixture/world", token));
            }
            if (now >= gameDue) {
              gameDue = now + 5000;
              polls.push(request("/api/game", token));
            }
            if (now >= rankingDue) {
              rankingDue = now + 5000;
              polls.push(request("/api/game/ranking", token));
            }
            if (now >= botsDue) {
              botsDue = now + 2000;
              polls.push(request("/api/fixture/bots", token));
            }
            const intent = peer.planner.next(peer.role);
            if (intent)
              polls.push(
                peer.explore(
                  intent.tile,
                  Uint8Array.from(
                    Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
                  ),
                ),
              );
            const results = await Promise.allSettled(polls);
            for (const result of results)
              if (result.status === "rejected") fail("CLIENT_OPERATION_FAILED");
            await pause(1200 + peer.planner.random() * 1600);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          fail(
            message === "Bot snapshot timeout"
              ? "SNAPSHOT_TIMEOUT"
              : "CLIENT_START_FAILED",
          );
        } finally {
          startupDone();
        }
      })(),
    );
    await pause(
      Math.max(
        0,
        rampStart + ((i + 1) * ramp * 1000) / count - performance.now(),
      ),
    );
  }
  await Promise.all(startups);
  steadyStartedAt = performance.now();
  steadyBaseline = totals();
  releasePlay();
  await Promise.allSettled(workers);
  completedAt = performance.now();
} catch (error) {
  fail("RUN_ABORTED");
  console.error(error instanceof Error ? error.message : "Run failed");
  process.exitCode = 1;
} finally {
  if (ticker) clearInterval(ticker);
  const beforeClose = {
    ...progress(),
    transportErrors: peers.filter((p) => p.error).length,
  };
  const elapsed = ((completedAt ?? performance.now()) - startedAt) / 1000;
  const steadySeconds = steadyStartedAt
    ? ((completedAt ?? performance.now()) - steadyStartedAt) / 1000
    : 0;
  const summary = {
    origin: origin.origin,
    requestedClients: count,
    durationSeconds: duration,
    rampSeconds: ramp,
    assets,
    ...beforeClose,
    elapsedSeconds: elapsed,
    steadySeconds,
    rampAndInitialization: steadyBaseline ?? null,
    interrupted: stop,
    ackMs: latencySummary(peers.flatMap((p) => p.latencies)),
    generatorTimerSlipMs: latencySummary(timerSlipMs),
    projectionObservedMs: latencySummary(
      peers.flatMap((p) => p.visibleLatencies().samples),
    ),
    projectionMissingAtEnd: peers.reduce(
      (n, p) => n + p.visibleLatencies().missing,
      0,
    ),
    websocketM2: {
      receivedBytes: totals().rx,
      sentBytes: totals().tx,
      resyncs: peers.reduce((n, p) => n + p.resyncs, 0),
      retries: peers.reduce((n, p) => n + p.retries, 0),
      closeCodes: peers.reduce(
        (all, p) => {
          if (p.lastCloseCode !== undefined)
            all[p.lastCloseCode] = (all[p.lastCloseCode] ?? 0) + 1;
          return all;
        },
        {} as Record<number, number>,
      ),
      closeReasons: peers.reduce(
        (all, p) => {
          if (p.lastCloseReason)
            all[p.lastCloseReason] = (all[p.lastCloseReason] ?? 0) + 1;
          return all;
        },
        {} as Record<string, number>,
      ),
      errors: peers.reduce(
        (all, p) => {
          if (p.error) all[p.error] = (all[p.error] ?? 0) + 1;
          return all;
        },
        {} as Record<string, number>,
      ),
      frameKinds: peers.reduce(
        (all, p) => {
          for (const [kind, n] of Object.entries(p.frameKinds))
            all[kind] = (all[kind] ?? 0) + n;
          return all;
        },
        {} as Record<string, number>,
      ),
      steadyReceiveMbps:
        steadyBaseline && steadySeconds
          ? ((totals().rx - steadyBaseline.rx) * 8) / steadySeconds / 1e6
          : null,
    },
    http: {
      ...http,
      latencyMs: latencySummary(http.latencyMs),
      steadyEncodedBodyMbps:
        steadyBaseline && steadySeconds
          ? ((totals().httpEncoded - steadyBaseline.httpEncoded) * 8) /
            steadySeconds /
            1e6
          : null,
      steadyDecodedBodyMbps:
        steadyBaseline && steadySeconds
          ? ((totals().http - steadyBaseline.http) * 8) / steadySeconds / 1e6
          : null,
    },
    failures,
    limitations: [
      "One machine/IP and network path; not 200 independent networks",
      "Protocol clients, no rendering/FPS or browser cache",
      "M2 bytes exclude Colyseus framing, TLS/TCP and handshake overhead",
      "HTTP encodedBodyBytes measures response payload before decoding; excludes HTTP/2 headers and TLS/TCP",
      "Warmup waits for all startup attempts, then clients begin polling/play together",
      "Shell assets exclude 3D models, textures and lazy chunks",
      "Projection observed is receipt of private own-school state, not a rendered pixel",
      "Result measures this route and workload, not a Cloudflare capacity limit",
    ],
  };
  await Promise.allSettled(peers.map((p) => p.close()));
  for (const session of httpSessions.values()) session.destroy();
  if (
    connected < count ||
    beforeClose.transportErrors ||
    http.errors ||
    Object.keys(failures).length
  )
    process.exitCode = 1;
  const directory = resolve("artifacts/public-clients");
  await mkdir(directory, { recursive: true });
  const output = resolve(
    directory,
    `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(output, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify(
      {
        ...beforeClose,
        ackMs: summary.ackMs,
        receiveMbps: summary.websocketM2.steadyReceiveMbps,
        report: output,
      },
      null,
      2,
    ),
  );
}

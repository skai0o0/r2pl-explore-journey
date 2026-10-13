import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { evaluateDevExplore } from "../shared/gameplay/devRules.ts";
import { ACK_STATUS } from "../shared/protocol/m2.ts";
import {
  type BotIntent,
  type BotRole,
  botSchools,
} from "../shared/simulation/schoolBots.ts";
import { crc32 } from "../shared/world/checksum.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";
import { BotPeer, pause, type ViewSignature } from "./simulation/BotPeer.ts";
import {
  assertBotOutputDirectory,
  BOT_CAPABILITIES,
  botDatabase,
  botRate,
  parseBotOptions,
} from "./simulation/config.ts";
import {
  cleanupBotFixture,
  fixtureMasks,
  migrateBotFixture,
  seedBotFixture,
} from "./simulation/fixture.ts";
import { botMapSvg, latencySummary, mapCoverage } from "./simulation/report.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.includes("--help")) {
  console.log(
    "Eight-school synthetic bot simulation. Requires R2PL_BOT_SIMULATION=1 and loopback R2PL_BOT_DATABASE_URL (r2pl_bot_test_* / r2pl_prep_test_*).\nOptions: --duration=60 --bots-per-school=3 --preset=slow|mixed|fast|bursty --rates=0.25,0.5,0.75,1,1.5,2,3,5 --layout=gather|contact|spread --region-size=128 --credits=500 --max-actions=10000 --seed=20261013 --retry-every=25 --reconnect-every=0 --keep-data=false --output=docs/benchmarks/bots\nContest/defense/upkeep are NOT available; --require-full-gameplay=true fails before starting.",
  );
} else {
  const options = parseBotOptions(process.argv.slice(2), workspace);
  const database = botDatabase(
    process.env.R2PL_BOT_DATABASE_URL,
    process.env.R2PL_BOT_SIMULATION,
  );
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(options.output, runId);
  await assertBotOutputDirectory(workspace, directory);
  await mkdir(directory, { recursive: true });
  const pool = new Pool({ connectionString: database, max: 16 });
  const campaignId = randomUUID();
  const schools = botSchools(options.layout, options.regionSize);
  const registry = new SchoolRegistry(
    schools.map((s) => ({ id: s.fixtureId, slot: s.slot })),
  );
  const peers: BotPeer[] = [];
  const observed = new Map<number, number>();
  const intents: Record<BotIntent, number> = {
    expand: 0,
    rendezvous: 0,
    revisit: 0,
  };
  const timeline: unknown[] = [];
  const failures: string[] = [];
  let fixture:
    | Awaited<ReturnType<typeof createDurableSyntheticServer>>
    | undefined;
  let stopped = false;
  let interrupted = false;
  let logicalActions = 0;
  let seeded = false;
  let phaseStart = 0;
  const stop = () => {
    stopped = true;
    interrupted = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    migrateBotFixture(database, workspace);
    const identities = await seedBotFixture(
      pool,
      campaignId,
      schools,
      options.botsPerSchool,
      options.credits,
    );
    seeded = true;
    fixture = await createDurableSyntheticServer(
      pool,
      campaignId,
      registry,
      identities,
      1n,
      {},
      undefined,
      evaluateDevExplore,
    );
    await fixture.server.listen(0, "127.0.0.1");
    const address = fixture.transport.server?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing bot loopback port");
    const endpoint = `ws://127.0.0.1:${address.port}`;
    const roles: BotRole[] = ["explorer", "connector", "steward"];
    let roomId: string | undefined;
    for (const identity of identities) {
      const peer = new BotPeer(
        endpoint,
        identity.token,
        schools[identity.schoolSlot]!,
        roles[(identity.ordinal % options.botsPerSchool) % 3]!,
        (options.seed ^ Math.imul(identity.ordinal + 1, 0x9e3779b9)) >>> 0,
      );
      peers.push(peer);
      roomId = await peer.connect(roomId);
    }
    console.log(
      `[bots] 8 synthetic schools, ${peers.length} WebSocket clients, ${options.preset} speeds; explore + overlap only. Full contest/defense/upkeep unavailable.`,
    );
    phaseStart = performance.now();
    const deadline = phaseStart + options.duration * 1000;
    let lastReport = phaseStart;
    const sample = async () => {
      const elapsed = (performance.now() - phaseStart) / 1000;
      const coverage = mapCoverage(observed);
      const row = {
        elapsedSeconds: Number(elapsed.toFixed(3)),
        logicalActions,
        applied: peers.reduce((n, p) => n + p.applied, 0),
        noChange: peers.reduce((n, p) => n + p.noChange, 0),
        uniqueTiles: coverage.uniqueTiles,
        overlapTiles: coverage.overlapTiles,
        schoolTiles: coverage.schoolTiles,
      };
      timeline.push(row);
      await writeFile(
        resolve(directory, "map.svg"),
        botMapSvg(schools, observed),
      );
      await writeFile(
        resolve(directory, "live.json"),
        JSON.stringify(
          {
            scope: "synthetic-admin-observer",
            capabilities: BOT_CAPABILITIES,
            ...row,
          },
          null,
          2,
        ),
      );
      console.log(
        `[bots] t=${Math.round(elapsed)}s actions=${logicalActions} knowledge=${coverage.uniqueTiles} overlapping=${coverage.overlapTiles}`,
      );
    };
    await sample();
    const workers = peers.map(async (peer, index) => {
      let sequence = 0;
      await pause(
        Math.min(
          (peer.planner.random() * 1000) / options.rates[peer.school.slot]!,
          Math.max(0, deadline - performance.now()),
        ),
      );
      while (
        !stopped &&
        performance.now() < deadline &&
        logicalActions < options.maxActions &&
        peer.applied < options.credits
      ) {
        const intent = peer.planner.next(peer.role);
        if (!intent) break;
        const started = performance.now();
        logicalActions++;
        sequence++;
        intents[intent.intent]++;
        const key = new Uint8Array(16);
        const data = new DataView(key.buffer);
        data.setUint32(0, sequence, true);
        data.setUint32(4, index, true);
        data.setUint32(8, options.seed, true);
        key[15] = 0xb8;
        const ack = await peer.explore(intent.tile, key);
        if (ack.status === ACK_STATUS.TEST_APPLIED)
          observed.set(
            intent.tile,
            (observed.get(intent.tile) ?? 0) | (1 << peer.school.slot),
          );
        if (options.retryEvery && sequence % options.retryEvery === 0) {
          const replay = await peer.replay(intent.tile, key);
          if (
            replay.status !== ack.status ||
            replay.viewRevision !== ack.viewRevision
          )
            throw new Error("Stable-key retry did not return original ACK");
        }
        if (options.reconnectEvery && sequence % options.reconnectEvery === 0) {
          await peer.reconnect();
          const replay = await peer.replay(intent.tile, key);
          if (
            replay.status !== ack.status ||
            replay.viewRevision !== ack.viewRevision
          )
            throw new Error("Reconnect changed committed action");
        }
        const elapsed = (performance.now() - phaseStart) / 1000;
        const interval =
          (1000 / botRate(options, peer.school.slot, elapsed)) *
          (0.8 + peer.planner.random() * 0.4);
        if (performance.now() - lastReport >= 5000) {
          lastReport = performance.now();
          await sample();
        }
        await pause(
          Math.min(
            Math.max(0, interval - (performance.now() - started)),
            Math.max(0, deadline - performance.now()),
          ),
        );
      }
    });
    await Promise.all(
      workers.map((p) =>
        p.catch(() => {
          failures.push(
            "A bot failed: transport, ACK retry or reconnect did not complete",
          );
          stopped = true;
        }),
      ),
    );
    const elapsedSeconds = (performance.now() - phaseStart) / 1000;
    const drainDeadline = performance.now() + 45000;
    let pendingOutbox = 0;
    do {
      await fixture.core.drainOutbox();
      pendingOutbox = Number(
        (
          await pool.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL",
            [campaignId],
          )
        ).rows[0]!.n,
      );
      if (pendingOutbox) await pause(20);
    } while (pendingOutbox && performance.now() < drainDeadline);
    const expected = new Map<string, ViewSignature>();
    for (const peer of peers)
      for (const chunk of peer.chunks) {
        const id = `${peer.school.slot}:${chunk}`;
        if (!expected.has(id)) {
          const snapshot = await fixture.authority.snapshot(
            peer.school.slot,
            chunk,
          );
          expected.set(id, {
            slot: peer.school.slot,
            chunk,
            revision: snapshot.viewRevision.toString(),
            maskCrc: crc32(snapshot.mask),
            fogCrc: crc32(snapshot.fog),
          });
        }
      }
    const converged = () =>
      peers.every(
        (p) =>
          !p.error &&
          p.signatures().every((actual) => {
            const value = expected.get(`${actual.slot}:${actual.chunk}`);
            return (
              value &&
              actual.revision === value.revision &&
              actual.maskCrc === value.maskCrc &&
              actual.fogCrc === value.fogCrc
            );
          }),
      );
    while (!converged() && performance.now() < drainDeadline) await pause(20);
    const actualMasks = await fixtureMasks(pool, campaignId);
    const maskMatch =
      actualMasks.size === observed.size &&
      [...actualMasks].every(([tile, mask]) => observed.get(tile) === mask);
    const wallets = await pool.query<{
      actor_id: string;
      balance: string;
      opening_balance: string;
      ledger: string;
    }>(
      "SELECT w.actor_id,w.balance::text,w.opening_balance::text,COALESCE((SELECT sum(amount) FROM r2pl_v2.ledger_entries l WHERE l.campaign_id=w.campaign_id AND l.actor_id=w.actor_id),0)::text AS ledger FROM r2pl_v2.wallet_accounts w WHERE w.campaign_id=$1 AND resource='fixture-credit'",
      [campaignId],
    );
    const walletMatch =
      wallets.rows.length === peers.length &&
      identities.every((identity, index) => {
        const row = wallets.rows.find((r) => r.actor_id === identity.actorId);
        return (
          row &&
          BigInt(row.balance) ===
            BigInt(options.credits - peers[index]!.applied) &&
          BigInt(row.balance) ===
            BigInt(row.opening_balance) + BigInt(row.ledger)
        );
      });
    const records = await pool.query<{ n: string; applied: string }>(
      "SELECT count(*)::text AS n,count(*) FILTER(WHERE status='test_applied')::text AS applied FROM r2pl_v2.command_results WHERE campaign_id=$1",
      [campaignId],
    );
    const recordMatch =
      Number(records.rows[0]!.n) === logicalActions &&
      Number(records.rows[0]!.applied) ===
        peers.reduce((n, p) => n + p.applied, 0);
    const visible = peers.map((p) => p.visibleLatencies());
    await sample();
    const integrity = {
      schoolViewsConverged: converged(),
      ackMapMatchesDatabase: maskMatch,
      walletConservation: walletMatch,
      idempotencyRecords: recordMatch,
      outboxDrained: pendingOutbox === 0,
      ownVisibleSamplesComplete: visible.every((v) => v.missing === 0),
    };
    const status =
      failures.length || !Object.values(integrity).every(Boolean)
        ? "failed"
        : interrupted
          ? "interrupted"
          : "completed";
    const coverage = mapCoverage(actualMasks);
    const report = {
      version: 1,
      scope: "synthetic-admin-simulation",
      status,
      termination:
        status !== "completed"
          ? status
          : logicalActions >= options.maxActions
            ? "action_budget"
            : elapsedSeconds >= options.duration - 0.01
              ? "duration"
              : "credits_or_frontier_exhausted",
      runId,
      campaignId,
      retainedDatabaseData: options.keepData,
      capabilities: BOT_CAPABILITIES,
      limitations: [
        "Knowledge overlap uses fixture-credit ruleVersion 0; not a production shared contest.",
        "No contest/defense/upkeep/decay command exists in protocol v1.",
        "School labels are presentation aliases; IDs/slots/layout are synthetic, not production onboarding.",
        "Same-process server and generator on one host; no launch capacity claim.",
      ],
      options,
      environment: {
        node: process.version,
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        topology: "same-process durable server + WebSocket bots",
      },
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      logicalActions,
      wireCommands: peers.reduce((n, p) => n + p.wireCommands, 0),
      intents,
      coverage,
      integrity,
      metrics: {
        ackLatencyMs: latencySummary(peers.flatMap((p) => p.latencies)),
        ownReplicaVisibilityMs: latencySummary(
          visible.flatMap((v) => v.samples),
        ),
        missingVisibleSamples: visible.reduce((n, v) => n + v.missing, 0),
        retries: peers.reduce((n, p) => n + p.retries, 0),
        reconnects: peers.reduce((n, p) => n + p.reconnects, 0),
        resyncs: peers.reduce((n, p) => n + p.resyncs, 0),
        m2FramesReceived: peers.reduce((n, p) => n + p.frames, 0),
        m2BytesReceived: peers.reduce((n, p) => n + p.bytes, 0),
      },
      schools: schools.map((s) => {
        const team = peers.filter((p) => p.school.slot === s.slot);
        return {
          label: s.label,
          fixtureId: s.fixtureId,
          slot: s.slot,
          requestedPerBotRate: options.rates[s.slot],
          bots: team.length,
          roles: team.map((p) => p.role),
          applied: team.reduce((n, p) => n + p.applied, 0),
          noChange: team.reduce((n, p) => n + p.noChange, 0),
          rejected: team.reduce((n, p) => n + p.rejected, 0),
          knowledgeTiles: coverage.schoolTiles[s.slot],
        };
      }),
      serverMetrics: fixture.core.metrics.snapshot(),
      failures,
    };
    await writeFile(
      resolve(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await writeFile(
      resolve(directory, "timeline.json"),
      JSON.stringify(timeline, null, 2),
    );
    console.log(`[bots] ${status} report=${resolve(directory, "report.json")}`);
    if (status !== "completed") process.exitCode = interrupted ? 130 : 1;
  } catch {
    process.exitCode = 1;
    await writeFile(
      resolve(directory, "failure.json"),
      JSON.stringify(
        {
          status: "failed",
          scope: "synthetic-only",
          message:
            "Bot simulation did not complete; check local fixture setup/transport and report.json if present",
        },
        null,
        2,
      ),
    );
    console.error(
      `[bots] Simulation failed; see ${resolve(directory, "failure.json")}`,
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await Promise.allSettled(peers.map((p) => p.close()));
    fixture?.core.stopRelay();
    if (fixture) await fixture.server.gracefullyShutdown(false);
    try {
      if (seeded && !options.keepData)
        await cleanupBotFixture(pool, campaignId);
    } finally {
      await pool.end();
    }
  }
}

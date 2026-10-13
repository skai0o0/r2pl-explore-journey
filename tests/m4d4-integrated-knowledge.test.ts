import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { boundedKnowledgeMarkers } from "../client/src/worldView.ts";
import {
  attachIntegratedRoutes,
  integratedDatabaseUrl,
  m3Fixtures,
} from "../scripts/play-integrated-knowledge-qa.ts";
import {
  createKnowledgeQaServer,
  type QaBackendV1,
} from "../server/qa/KnowledgeQaGatewayV1.ts";

test("integrated bridge fails closed and keeps fixture slots isolated", () => {
  const env = {
    R2PL_DEV_PLAY: "1",
    R2PL_M4D4_INTEGRATED_QA: "1",
    R2PL_TEST_DATABASE_URL: "postgres://user:secret@127.0.0.1/r2pl_test_bridge",
  };
  assert.equal(integratedDatabaseUrl(env), env.R2PL_TEST_DATABASE_URL);
  for (const flags of [
    { R2PL_DEV_PLAY: "0" },
    { R2PL_M4D4_INTEGRATED_QA: "0" },
    { R2PL_TEST_DATABASE_URL: "postgres://user:secret@localhost/production" },
  ])
    assert.throws(() => integratedDatabaseUrl({ ...env, ...flags }));
  assert.deepEqual(
    m3Fixtures.map((f) => f.schoolSlot),
    [0, 0, 15, 15],
  );
});
test("Knowledge markers validate, deduplicate and bound independently of M3", () => {
  const markers = boundedKnowledgeMarkers([
    { tileIndex: -1, schoolSlots: [] },
    { tileIndex: 1_000_000, schoolSlots: [] },
    { tileIndex: 1.5, schoolSlots: [] },
    ...Array.from({ length: 60 }, (_, tileIndex) => ({
      tileIndex,
      schoolSlots: [1],
    })),
    { tileIndex: 0, schoolSlots: [0] },
  ]);
  assert.equal(markers.length, 48);
  assert.equal(new Set(markers.map((m) => m.tileIndex)).size, 48);
  assert.equal(markers[0]?.title, "QA tile 0: Schools 1");
});
test("bridge preserves mandatory authenticated Knowledge routes and rejects forged identity", async (t) => {
  const fixtures = [0, 1].map((schoolSlot) => ({
    token: `qa-${schoolSlot}`,
    actorId: `actor-${schoolSlot}`,
    schoolSlot,
    label: `School ${schoolSlot}`,
  }));
  let actor = "";
  const receipt = {
    kind: "apply",
    reason: "training",
    acceptedPoints: "0",
    revision: 1,
    status: "claiming",
  } as const;
  const backend: QaBackendV1 = {
    fixtures,
    state: async (f) => ({
      campaignId: "knowledge-only",
      viewer: { label: f.label, schoolSlot: f.schoolSlot },
      walletPoints: "50",
      case: null,
      tiles: [],
      scores: [],
      projectionPending: false,
      updatedAtMs: 1,
    }),
    start: async () => receipt,
    contribute: async (f) => {
      actor = f.actorId;
      return receipt;
    },
    sync: async () => {},
  };
  const server = createKnowledgeQaServer(backend, "dist/client");
  attachIntegratedRoutes(server, async (token) =>
    token === "dawn-one" ? { balance: "30", fixtureOnly: true } : undefined,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, token?: string, payload?: object) =>
    fetch(base + path, {
      method: payload ? "POST" : "GET",
      headers: {
        ...(token ? { "X-QA-Token": token } : {}),
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  assert.equal((await call("/api/qa/integrated-mode")).status, 200);
  assert.equal(
    (await call("/api/qa/integrated-mode", undefined, {})).status,
    405,
  );
  assert.equal((await call("/api/fixture/me")).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/fixture/me`, {
        headers: { Authorization: "Bearer dawn-one" },
      })
    ).status,
    200,
  );
  assert.equal((await call("/api/qa/fixtures")).status, 200);
  assert.equal((await call("/api/qa/state")).status, 401);
  assert.equal((await call("/api/qa/state", "qa-1")).status, 200);
  assert.equal((await call("/api/qa/scenario/start", "qa-1", {})).status, 403);
  assert.equal((await call("/api/qa/scenario/start", "qa-0", {})).status, 200);
  const payload = {
    caseId: "10000000-0000-4000-8000-000000000001",
    contributionId: "10000000-0000-4000-8000-000000000002",
    points: "1",
  };
  assert.equal(
    (
      await call("/api/qa/knowledge/contribute", "qa-1", {
        ...payload,
        actorId: "forged",
        schoolSlot: 0,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/qa/knowledge/contribute", "qa-1", payload)).status,
    200,
  );
  assert.equal(actor, "actor-1");
  assert.equal((await call("/api/qa/sync", "qa-1", {})).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/qa/integrated-mode`, {
        headers: { Origin: "http://evil.invalid" },
      })
    ).status,
    403,
  );
  const response = await call("/missing");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /ws:\/\/127\.0\.0\.1:2567/,
  );
});
test("UI mounts once outside camera shortcut and never paints Knowledge into chunks", async () => {
  const read = (path: string) =>
    readFile(new URL(path, import.meta.url), "utf8");
  const [main, panel, html, launcher] = await Promise.all([
    read("../client/src/main.ts"),
    read("../client/src/knowledgePanel.ts"),
    read("../client/index.html"),
    read("../scripts/play-integrated-knowledge-qa.ts"),
  ]);
  assert.equal(html.match(/id="knowledge-panel"/g)?.length, 1);
  assert.equal(main.match(/void mountKnowledgePanel\(world\)/g)?.length, 1);
  assert.match(main, /ws:\/\/\$\{location.hostname\}:2567/);
  assert.match(panel, /if \(mounted\) return/);
  assert.match(panel, /clearInterval/);
  assert.doesNotMatch(panel, /paintTile|paintChunk|actorId\s*:/);
  assert.match(launcher, /'fixture-credit'/);
  assert.doesNotMatch(launcher, /execFileSync|migrateM4/);
});

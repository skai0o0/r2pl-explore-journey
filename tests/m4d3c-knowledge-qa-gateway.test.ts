import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  createKnowledgeQaServer,
  createPostgresKnowledgeQa,
  type QaBackendV1,
  type QaStateV1,
  qaDatabaseUrl,
} from "../server/qa/KnowledgeQaGatewayV1.ts";

test("QA environment fails closed without opt-in, CA or disposable target", () => {
  for (const env of [
    {},
    { R2PL_DEV_PLAY: "1" },
    {
      R2PL_DEV_PLAY: "1",
      NODE_EXTRA_CA_CERTS: "ca.pem",
      R2PL_TEST_DATABASE_URL: "postgres://user:secret@localhost/production",
    },
  ])
    assert.throws(() => qaDatabaseUrl(env));
  assert.equal(
    qaDatabaseUrl({
      R2PL_DEV_PLAY: "1",
      NODE_EXTRA_CA_CERTS: "ca.pem",
      R2PL_TEST_DATABASE_URL: "postgres://user:secret@127.0.0.1/r2pl_test_qa",
    }),
    "postgres://user:secret@127.0.0.1/r2pl_test_qa",
  );
});

test("local HTTP authentication, fixture switching and input validation", async (t) => {
  const fixtures = [0, 1].map((schoolSlot) => ({
    token: randomUUID(),
    actorId: randomUUID(),
    label: `Synthetic ${schoolSlot}`,
    schoolSlot,
  }));
  const campaignId = randomUUID();
  const caseId = randomUUID();
  let contributions = 0;
  let syncs = 0;
  const state = (slot: number): QaStateV1 => ({
    campaignId,
    viewer: { label: `Synthetic ${slot}`, schoolSlot: slot },
    walletPoints: "50",
    case: null,
    tiles: [],
    scores: [],
    projectionPending: false,
    updatedAtMs: 1,
  });
  const backend: QaBackendV1 = {
    fixtures,
    state: async (fixture) => state(fixture.schoolSlot),
    start: async () => ({
      kind: "apply",
      reason: "training",
      acceptedPoints: "0",
      revision: 1,
      status: "claiming",
    }),
    contribute: async (fixture) => {
      assert.equal(fixture.actorId, fixtures[1]!.actorId);
      contributions++;
      return {
        kind: "apply",
        reason: "contributed",
        acceptedPoints: "1",
        revision: 2,
        status: "success",
      };
    },
    sync: async () => {
      syncs++;
    },
  };
  const server = createKnowledgeQaServer(backend, "dist/knowledge-qa");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, token?: string, value?: unknown) =>
    fetch(base + path, {
      headers: {
        ...(token ? { "X-QA-Token": token } : {}),
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(value === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(value) }),
    });
  assert.equal((await call("/api/qa/state")).status, 401);
  assert.equal((await call("/api/qa/state", "bad")).status, 401);
  const listed = await (await call("/api/qa/fixtures")).text();
  assert(!listed.includes("actorId"));
  assert(!listed.includes(fixtures[0]!.actorId));
  for (const fixture of fixtures) {
    const result = await call("/api/qa/state", fixture.token);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal((await result.json()).viewer.schoolSlot, fixture.schoolSlot);
  }
  assert.equal(
    (await call("/api/qa/scenario/start", fixtures[1]!.token, {})).status,
    403,
  );
  assert.equal(
    (await call("/api/qa/scenario/start", fixtures[0]!.token, { tiles: [] }))
      .status,
    400,
  );
  assert.equal(
    (await call("/api/qa/scenario/start", fixtures[0]!.token, {})).status,
    200,
  );
  const input = { caseId, contributionId: randomUUID(), points: "1" };
  for (const forged of [
    { ...input, actorId: fixtures[0]!.actorId },
    { ...input, schoolSlot: 0 },
    { ...input, points: "51" },
    { ...input, points: 1 },
    { ...input, contributionId: "bad" },
  ])
    assert.equal(
      (await call("/api/qa/knowledge/contribute", fixtures[1]!.token, forged))
        .status,
      400,
    );
  assert.equal(contributions, 0);
  assert.equal(
    (await call("/api/qa/knowledge/contribute", fixtures[1]!.token, input))
      .status,
    200,
  );
  assert.equal(
    (await call("/api/qa/sync", fixtures[1]!.token, {})).status,
    200,
  );
  assert.equal(syncs, 1);
  const oversized = await call("/api/qa/sync", fixtures[1]!.token, {
    padding: "x".repeat(4096),
  });
  assert.equal(oversized.status, 413);
  const cross = await fetch(`${base}/api/qa/fixtures`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(cross.status, 403);
  backend.sync = async () => {
    throw new Error("SELECT secret_password FROM private_outbox");
  };
  const failed = await call("/api/qa/sync", fixtures[1]!.token, {});
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), '{"error":"QA request failed"}');
});

test("real PostgreSQL QA contribution replay, projection and bounded processing", {
  skip: !process.env.R2PL_TEST_DATABASE_URL && "Disposable database URL absent",
}, async (t) => {
  const runtime = await createPostgresKnowledgeQa();
  t.after(() => runtime.close());
  const { backend } = runtime;
  const operator = backend.fixtures[0]!;
  const claimant = backend.fixtures[1]!;
  await backend.start();
  await assert.rejects(() => backend.start());
  const before = await backend.state(claimant);
  assert.equal(before.walletPoints, "50");
  assert(before.case);
  assert(before.projectionPending);
  const input = {
    caseId: before.case.caseId,
    contributionId: randomUUID(),
    points: "1",
  };
  const first = await backend.contribute(claimant, input);
  assert.deepEqual(await backend.contribute(claimant, input), first);
  await assert.rejects(() =>
    backend.contribute(claimant, { ...input, points: "2" }),
  );
  assert.equal((await backend.state(claimant)).walletPoints, "49");
  assert.equal((await backend.state(operator)).walletPoints, "50");
  await backend.sync();
  const after = await backend.state(claimant);
  assert.equal(after.projectionPending, false);
  assert.equal(after.case?.status, "success");
  assert.equal(after.tiles.length, 3);
  assert(
    after.tiles.every(
      (tile) => tile.schoolSlots.length === 1 && tile.schoolSlots[0] === 1,
    ),
  );
  assert.equal(
    after.scores.find((score) => score.schoolSlot === 1)?.score,
    "3",
  );
  const output = JSON.stringify(after);
  for (const hidden of [
    "actorId",
    "contributions",
    "effects",
    "active_school_mask",
    claimant.token,
    operator.actorId,
  ])
    assert(!output.includes(hidden));
  await backend.sync();
  assert.equal((await backend.state(claimant)).walletPoints, "49");
  // Ten durable outbox revisions exceed the diagnostic endpoint's eight-cycle budget.
  for (let index = 0; index < 5; index++) {
    await backend.start();
    const next = await backend.state(claimant);
    assert(next.case);
    await backend.contribute(claimant, {
      caseId: next.case.caseId,
      contributionId: randomUUID(),
      points: "1",
    });
  }
  await backend.sync();
  assert.equal((await backend.state(claimant)).projectionPending, true);
  await backend.sync();
  const drained = await backend.state(claimant);
  assert.equal(drained.projectionPending, false);
  assert.equal(drained.tiles.length, 18);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("M4-D3c QA page wires its action controls and safe browser renderer", async () => {
  const [html, ts, css] = await Promise.all([
    readFile(
      new URL("../client/qa-knowledge/index.html", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../client/qa-knowledge/main.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../client/qa-knowledge/style.css", import.meta.url),
      "utf8",
    ),
  ]);
  for (const id of [
    "player-select",
    "scenario-button",
    "contribute-button",
    "retry-button",
    "sync-button",
    "wallet-balance",
    "score-0",
    "score-1",
    "case-status",
    "tile-pins",
    "last-updated",
    "error-box",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.ok(ts.includes(`"${id}"`), `Missing client binding ${id}`);
  }
  assert.match(html, /SYNTHETIC QA ONLY/);
  assert.match(html, /PRODUCTION OFF/);
  assert.match(ts, /textContent/);
  assert.doesNotMatch(ts, /\.innerHTML\s*=/);
  assert.doesNotMatch(ts, /localStorage|sessionStorage/);
  assert.match(css, /@media/);
});

test("M4-D3c QA browser calls exact server-owned endpoints with fixture tokens", async () => {
  const ts = await readFile(
    new URL("../client/qa-knowledge/main.ts", import.meta.url),
    "utf8",
  );
  for (const path of [
    "/api/qa/fixtures",
    "/api/qa/state",
    "/api/qa/scenario/start",
    "/api/qa/knowledge/contribute",
    "/api/qa/sync",
  ])
    assert.ok(ts.includes(path), `Missing HTTP route ${path}`);
  assert.match(ts, /"X-QA-Token"/);
  assert.match(ts, /crypto\.randomUUID\(\)/);
  assert.match(ts, /lastPayment/);
  assert.match(ts, /setInterval/);
  assert.doesNotMatch(ts, /actorId\s*:/);
  assert.doesNotMatch(ts, /fetch\(\s*["']https?:/);
});

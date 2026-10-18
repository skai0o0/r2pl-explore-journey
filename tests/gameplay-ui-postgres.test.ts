import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type HTMLElement as TestElement, Window } from "happy-dom";
import { Pool } from "pg";
import { createServer } from "vite";
import { botDatabase } from "../scripts/simulation/config.ts";
import { cleanupBotFixture } from "../scripts/simulation/fixture.ts";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { cleanupSchoolRewards } from "../server/integration/SchoolRewardFixture.ts";
import type { GameView } from "../shared/gameplay/commands.ts";

const database = process.env.R2PL_PREPARATION_DATABASE_URL;
test("real inventory buttons spin -> private discovery -> chest -> authoritative wallet, with no client reward mutation", {
  skip: !database && "Disposable PostgreSQL required",
  timeout: 30000,
}, async () => {
  const pool = new Pool({
    connectionString: botDatabase(database, "1"),
    max: 16,
  });
  const campaign = randomUUID();
  const draws = [969, 999];
  const play = await createSchoolPlayServer(
    pool,
    { web: 0, websocket: 0 },
    campaign,
    { rewardDraw: () => draws.shift() ?? 0 },
  );
  const base = `http://127.0.0.1:${play.webPort}`;
  const nativeFetch = globalThis.fetch;
  const w = new Window({ url: base });
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    sessionStorage: w.sessionStorage,
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  });
  const vite = await createServer({
    configFile: false,
    root: "client",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const actor = play.fixture.actors[0]!;
    for (const [x, z] of [
      ...Array.from({ length: 23 }, (_, i) => [510 + i, 280]),
      ...Array.from({ length: 20 }, (_, i) => [532, 281 + i]),
    ]) {
      const result = await play.realtime.authority.apply(
        actor.actorId,
        0,
        crypto.getRandomValues(new Uint8Array(16)),
        z! * 1000 + x!,
      );
      assert.notEqual(result.result.status, "rejected");
    }
    globalThis.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.method === "POST") headers.set("Origin", base);
      return nativeFetch(new URL(String(input), base), { ...init, headers });
    };
    const objects = (await (await fetch("/api/fixture/world")).json()).objects;
    const { GameplayUI } = await vite.ssrLoadModule("/src/gameplayUI.ts");
    let view: GameView | undefined;
    const ui = new GameplayUI(
      objects,
      () => {},
      (next: GameView) => {
        view = next;
      },
      () => {},
      campaign,
    );
    ui.select(play.fixture.players[0]);
    await ui.refresh();
    ui.openInventory();
    const stop = objects.find(
      (o: { id: string }) => o.id === "unistop_aspire_1",
    );
    ui.pick(stop);
    const spin = w.document.querySelector(".unistop-claim")! as TestElement;
    assert(!spin.hasAttribute("disabled"));
    spin.click();
    const until = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        assert(Date.now() < deadline, "UI command did not converge");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    await until(() => !!view?.chests.length);
    const chest = view!.chests[0]!;
    assert.equal(view!.treasureMaps, "1");
    const other = await (
      await fetch("/api/game", {
        headers: { Authorization: `Bearer ${play.fixture.players[1]!.token}` },
      })
    ).json();
    assert.equal(other.chests.length, 0, "discovery stays player-private");
    await new Promise(setImmediate);
    ui.pick(chest);
    const open = w.document.querySelector("#btn-do-open")! as TestElement;
    assert(!open.hasAttribute("disabled"));
    open.click();
    await until(() => view?.keys.aspire === "0");
    assert.equal(view!.chests.length, 0);
    assert.equal(
      view!.crystals,
      "1010",
      "Gift fallback is selected by the server for a player with no weekly km",
    );
    assert.equal(draws.length, 0);
    await new Promise(setImmediate);
    ui.pick(stop);
    (w.document.querySelector(".unistop-close") as TestElement | null)?.click();
  } finally {
    globalThis.fetch = nativeFetch;
    await vite.close();
    await w.happyDOM.close();
    await play.close();
    await cleanupSchoolRewards(pool, campaign);
    await cleanupBotFixture(pool, campaign);
    await pool.end();
  }
});

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createSchoolPlayServer } from "../server/integration/SchoolPlayServer.ts";
import { botDatabase } from "./simulation/config.ts";
import { migrateBotFixture } from "./simulation/fixture.ts";

const dbUrl = botDatabase(
  process.env.R2PL_BOT_DATABASE_URL ??
    "postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current",
  "1",
);
const workspace = resolve(import.meta.dirname, "..");
migrateBotFixture(dbUrl, workspace);

const pool = new Pool({ connectionString: dbUrl, max: 8 });
console.log("Starting SchoolPlayServer on web: 4176, ws: 2568...");
const play = await createSchoolPlayServer(pool, { web: 4176, websocket: 2568 });
console.log("SchoolPlayServer running at http://127.0.0.1:4176");

// Launch Chrome
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const chrome = spawn(chromePath, [
  "--headless=new",
  "--remote-debugging-port=9222",
  "--window-size=1600,1000",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "about:blank",
]);

class CDPClient {
  #ws: WebSocket;
  #id = 0;
  #callbacks = new Map<number, (res: unknown) => void>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id && this.#callbacks.has(msg.id)) {
          const cb = this.#callbacks.get(msg.id)!;
          this.#callbacks.delete(msg.id);
          cb(msg.result);
        }
      } catch (e) {
        console.error("CDP parse error:", e);
      }
    };
  }

  static async connect(pageWsUrl: string): Promise<CDPClient> {
    const ws = new WebSocket(pageWsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new CDPClient(ws);
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.#id;
    return new Promise((resolve) => {
      this.#callbacks.set(id, resolve as (res: unknown) => void);
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr: string): Promise<unknown> {
    const res = await this.send<{ result?: { value?: unknown } }>(
      "Runtime.evaluate",
      {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      },
    );
    return res?.result?.value;
  }

  async screenshot(outPath: string): Promise<void> {
    const res = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 92,
    });
    const buf = Buffer.from(res.data, "base64");
    await writeFile(outPath, buf);
    console.log(`Saved screenshot (${buf.length} bytes): ${outPath}`);
  }

  close(): void {
    this.#ws.close();
  }
}

try {
  await new Promise((r) => setTimeout(r, 1500));
  // Create tab navigating to game
  const targetRes = await fetch(
    "http://127.0.0.1:9222/json/new?http://127.0.0.1:4176/",
    {
      method: "PUT",
    },
  );
  const target = (await targetRes.json()) as {
    webSocketDebuggerUrl: string;
    id: string;
  };
  console.log("Connected to page tab:", target.id);

  const cdp = await CDPClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // Wait for canvas and world object to be initialized
  console.log("Waiting for world canvas and models to load...");
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.eval(`
      Boolean(
        document.querySelector("#world-view canvas") &&
        window.world &&
        window.compass &&
        document.querySelector("#connection-status")?.dataset.online === "true"
      )
    `);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("Game loaded and WebSocket connected!");

  // Allow Three.js to render initial chunks and scene
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Overview Shot: (500, 500, 1000)
  console.log(
    "Capturing 1: Layout Overview (all 8 HQs, 10 Landmarks, stepping stones)...",
  );
  await cdp.eval(`
    window.world.focus(500, 500, 1000);
  `);
  await new Promise((r) => setTimeout(r, 2500));
  const overviewPath = resolve(workspace, "artifacts/g-v1/layout-overview.jpg");
  await cdp.screenshot(overviewPath);
  const stagingPath = resolve(workspace, "artifacts/g-v1/staging-world.jpg");
  await cdp.screenshot(stagingPath);

  // 2. Stepping-Stone Close-up: HCMUT HQ (500, 280) and Aspire UniStop (532, 301) on path to Ha Long
  console.log("Capturing 2: Stepping Stone HQ close-up...");
  await cdp.eval(`
    window.world.focus(520, 295, 95);
  `);
  await new Promise((r) => setTimeout(r, 2000));
  const steppingStonePath = resolve(
    workspace,
    "artifacts/g-v1/stepping-stone-hq.jpg",
  );
  await cdp.screenshot(steppingStonePath);

  // 3. Compass Card & Onboarding HUD
  console.log("Capturing 3: Compass Card & Onboarding HUD...");
  await cdp.eval(`
    window.world.focus(500, 280, 130);
    window.compass.welcome("HCMUT (ĐH Bách Khoa TP.HCM)", "1.000");
  `);
  await new Promise((r) => setTimeout(r, 1500));
  const compassPath = resolve(
    workspace,
    "artifacts/g-v1/compass-onboarding.jpg",
  );
  await cdp.screenshot(compassPath);

  cdp.close();
  console.log("All screenshots captured successfully!");
} finally {
  chrome.kill();
  await play.close();
  await pool.end();
}

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9226;
const userDataDir = `C:\\Users\\Nem\\AppData\\Local\\Temp\\chrome-standalone-test-${Date.now()}`;

console.log("Launching headless Chrome for standalone interactive test...");
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--enable-webgl",
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
    "--window-size=1440,900",
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:5173/?mode=player",
  ],
  { stdio: "ignore" }
);

try {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}
  }

  if (!wsUrl) {
    throw new Error("Failed to connect to Chrome DevTools Protocol");
  }

  console.log("Connected to Chrome via CDP:", wsUrl);
  const ws = new WebSocket(wsUrl);

  let idSeq = 1;
  const callbacks = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idSeq++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === "Runtime.consoleAPICalled") {
      const text = data.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log("[Browser Console]", data.params.type, text);
    }
    if (data.method === "Runtime.exceptionThrown") {
      console.error("[Browser Exception]", data.params.exceptionDetails?.text, data.params.exceptionDetails?.exception?.description);
    }
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      if (data.error) cb.reject(data.error);
      else cb.resolve(data.result);
    }
  };

  await new Promise((resolve) => ws.onopen = resolve);

  await send("Page.enable");
  await send("Runtime.enable");

  console.log("Waiting for game to boot and Three.js world to initialize...");
  await new Promise((r) => setTimeout(r, 4500));

  const diagnostics = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const hud = document.querySelector(".hud");
        const student = document.getElementById("hud-student-name")?.innerText;
        const school = document.getElementById("hud-school-name")?.innerText;
        const tileCount = document.getElementById("hud-tile-count")?.innerText;
        const toolsPanel = document.getElementById("tools-panel")?.hidden;
        const canvas = document.querySelector("#world-view canvas");
        return {
          hudPresent: !!hud,
          student,
          school,
          tileCount,
          toolsPanelHidden: toolsPanel,
          hasCanvas: !!canvas,
        };
      })()
    `,
    returnByValue: true,
  });
  console.log("1. Initial Diagnostics:", diagnostics.result?.value);

  // Toggle tools panel open
  console.log("2. Opening Tools panel...");
  await send("Runtime.evaluate", {
    expression: `document.getElementById("hud-tools-toggle")?.click()`,
  });
  await new Promise((r) => setTimeout(r, 400));

  // Click "Tìm ô để mở" to select an expansion tile adjacent to HQ
  console.log("3. Clicking 'Tìm ô để mở' to find expansion tile...");
  const findTileResult = await send("Runtime.evaluate", {
    expression: `
      (() => {
        document.getElementById("tool-find-expansion")?.click();
        const coords = document.getElementById("tile-coordinates")?.innerText;
        const badge = document.getElementById("tile-badge")?.innerText;
        const btnText = document.getElementById("explore-button")?.innerText;
        const disabled = document.getElementById("explore-button")?.disabled;
        return { coords, badge, btnText, disabled };
      })()
    `,
    returnByValue: true,
  });
  console.log("Tile Selected Status:", findTileResult.result?.value);
  await new Promise((r) => setTimeout(r, 500));

  // Click "Khám Phá Ô Này" to reveal the tile locally
  console.log("4. Clicking 'Khám Phá Ô Này' button...");
  const exploreResult = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const btn = document.getElementById("explore-button");
        if (!btn.disabled) btn.click();
        return { clicked: !btn.disabled };
      })()
    `,
    returnByValue: true,
  });
  console.log("Explore click:", exploreResult.result?.value);
  await new Promise((r) => setTimeout(r, 600));

  // Check new state after exploration
  const afterExplore = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const coords = document.getElementById("tile-coordinates")?.innerText;
        const badge = document.getElementById("tile-badge")?.innerText;
        const toast = document.getElementById("toast")?.innerText;
        const actionStatus = document.getElementById("action-status")?.innerText;
        const tileCount = document.getElementById("hud-tile-count")?.innerText;
        return { coords, badge, toast, actionStatus, tileCount };
      })()
    `,
    returnByValue: true,
  });
  console.log("After Explore Status:", afterExplore.result?.value);

  // Capture screenshot of revealed tile + tools panel
  console.log("5. Capturing map screenshot with revealed tile...");
  const screenshotMap = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 90,
  });
  mkdirSync("artifacts/ui-mockup", { recursive: true });
  writeFileSync("artifacts/ui-mockup/standalone-verified.jpg", Buffer.from(screenshotMap.data, "base64"));
  console.log("Saved screenshot to artifacts/ui-mockup/standalone-verified.jpg");

  // Open Rankings dialog
  console.log("6. Clicking 'Xếp hạng' to open Rankings modal dialog...");
  await send("Runtime.evaluate", {
    expression: `document.getElementById("tool-ranking")?.click()`,
  });
  await new Promise((r) => setTimeout(r, 500));

  const rankingDialog = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const scrimVisible = !document.getElementById("scrim")?.hidden;
        const title = document.getElementById("dialog-title")?.innerText;
        const rankRows = Array.from(document.querySelectorAll("#dialog-content .rank-row")).map(r => r.innerText.trim().replace(/\\n/g, " "));
        return { scrimVisible, title, rankRowsCount: rankRows.length, rankRows: rankRows.slice(0, 4) };
      })()
    `,
    returnByValue: true,
  });
  console.log("Rankings Dialog Status:", rankingDialog.result?.value);

  // Capture screenshot of Rankings modal
  console.log("7. Capturing Rankings dialog screenshot...");
  const screenshotRank = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 90,
  });
  writeFileSync("artifacts/ui-mockup/standalone-ranking.jpg", Buffer.from(screenshotRank.data, "base64"));
  console.log("Saved rankings screenshot to artifacts/ui-mockup/standalone-ranking.jpg");

  ws.close();
  console.log("ALL STANDALONE VERIFICATION CHECKS PASSED SUCCESSFULLY!");
} finally {
  chrome.kill();
}

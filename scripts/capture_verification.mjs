import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9223;
const userDataDir = `C:\\Users\\Nem\\AppData\\Local\\Temp\\chrome-test-profile-${Date.now()}`;

console.log("Launching headless Chrome...");
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--enable-webgl",
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
    "--window-size=1600,1000",
    "--no-first-run",
    "--no-default-browser-check",
    "http://127.0.0.1:4176",
  ],
  { stdio: "ignore" }
);

try {
  // Wait for remote debugging to be ready
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

  // Wait 4 seconds for assets, 3D scene, and GLB to finish loading
  console.log("Waiting for 3D scene & GLB model to load...");
  await new Promise((r) => setTimeout(r, 4500));

  // Evaluate some diagnostics in page
  const diagnostics = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const hud = document.querySelector(".school-pill")?.innerText;
        const territory = document.querySelector(".stat-territory")?.innerText;
        return { hud, territory };
      })()
    `,
    returnByValue: true,
  });
  console.log("Page diagnostics:", diagnostics.result?.value);

  // Capture screenshot
  console.log("Capturing screenshot...");
  const screenshot = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 90,
  });

  const buffer = Buffer.from(screenshot.data, "base64");
  writeFileSync("artifacts/g-v1/hcmut-hq-glb.jpg", buffer);
  console.log("Saved screenshot to artifacts/g-v1/hcmut-hq-glb.jpg, size:", buffer.length);

  ws.close();
} finally {
  chrome.kill();
}

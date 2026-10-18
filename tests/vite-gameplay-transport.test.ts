import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { Room, Server } from "@colyseus/core";
import { ColyseusSDK } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "vite";
import config from "../vite.config.ts";

class ProxyRoom extends Room {
  onCreate(): void {
    this.onMessageBytes("m2", (client, bytes: Uint8Array) =>
      client.sendBytes("m2", bytes),
    );
  }
}
test("Vite forwards both Colyseus matchmaking and binary WebSocket messages", {
  timeout: 15000,
}, async () => {
  const transport = new WebSocketTransport();
  const authority = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  authority.define("proxy-regression", ProxyRoom);
  await authority.listen(0, "127.0.0.1");
  const bound = transport.server!.address();
  assert(bound && typeof bound !== "string");
  const proxy = config.server!.proxy!["/colyseus"];
  assert(proxy && typeof proxy !== "string");
  const vite = await createServer({
    configFile: false,
    root: "client",
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: null,
      proxy: {
        "/colyseus": { ...proxy, target: `http://127.0.0.1:${bound.port}` },
      },
    },
  });
  let room: Awaited<ReturnType<ColyseusSDK["joinOrCreate"]>> | undefined;
  try {
    await vite.listen();
    const address = vite.httpServer!.address();
    assert(address && typeof address !== "string");
    room = await new ColyseusSDK(
      `ws://127.0.0.1:${address.port}/colyseus`,
    ).joinOrCreate("proxy-regression");
    const reply = new Promise<Uint8Array>((resolve) =>
      room!.onMessage("m2", resolve),
    );
    room.sendBytes("m2", Uint8Array.of(1, 2, 3, 255));
    assert.deepEqual(Uint8Array.from(await reply), Uint8Array.of(1, 2, 3, 255));
  } finally {
    await room?.leave();
    await vite.close();
    await authority.gracefullyShutdown(false);
  }
});

test("Vite API proxy preserves Host so browser POST Origin passes same-origin validation", async () => {
  const backend = createHttpServer((request, response) => {
    response
      .writeHead(
        request.headers.origin === `http://${request.headers.host}` ? 200 : 403,
      )
      .end();
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const bound = backend.address();
  assert(bound && typeof bound !== "string");
  const proxy = config.server!.proxy!["/api"];
  assert(proxy && typeof proxy !== "string");
  const vite = await createServer({
    configFile: false,
    root: "client",
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: null,
      proxy: { "/api": { ...proxy, target: `http://127.0.0.1:${bound.port}` } },
    },
  });
  try {
    await vite.listen();
    const address = vite.httpServer!.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    assert.equal(
      (
        await fetch(`${origin}/api/game`, {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/game`, {
          method: "POST",
          headers: { Origin: "https://other.example" },
        })
      ).status,
      403,
    );
  } finally {
    await vite.close();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

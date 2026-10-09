import assert from "node:assert/strict";
import test from "node:test";
import { Room, Server } from "@colyseus/core";
import { ColyseusSDK } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";

class CompatibilityRoom extends Room {
  onCreate(): void {
    this.onMessage("echo", (_client, message: { value: string }) => ({
      value: message.value,
    }));
    this.onMessageBytes("bytes", (client, bytes: Uint8Array) =>
      client.sendBytes("bytes", bytes),
    );
  }
}

test("pinned Colyseus server, SDK and WebSocket transport exchange messages", {
  timeout: 10_000,
}, async () => {
  const transport = new WebSocketTransport();
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define("m1_compat", CompatibilityRoom);
  let room: Awaited<ReturnType<ColyseusSDK["joinOrCreate"]>> | undefined;
  try {
    await server.listen(0, "127.0.0.1");
    const address = transport.server?.address();
    if (!address || typeof address === "string")
      throw new Error("Missing bound test port");
    const sdk = new ColyseusSDK(`ws://127.0.0.1:${address.port}`);
    room = await sdk.joinOrCreate("m1_compat");
    assert.deepEqual(await room.request("echo", { value: "M1" }), {
      value: "M1",
    });
    const bytes = new Promise<Uint8Array>((resolve) =>
      room!.onMessage("bytes", (data: Uint8Array) => resolve(data)),
    );
    room.sendBytes("bytes", Uint8Array.of(0, 1, 15, 255));
    assert.deepEqual(
      Uint8Array.from(await bytes),
      Uint8Array.of(0, 1, 15, 255),
    );
  } finally {
    await room?.leave();
    await server.gracefullyShutdown(false);
  }
});

import { type Client, Room } from "@colyseus/core";
import type { RealtimeCore } from "./RealtimeCore.ts";
import type { SyntheticAuth, SyntheticIdentity } from "./SyntheticAuth.ts";

/** Thin Colyseus adapter. All world, visibility and command decisions live in RealtimeCore. */
export function createGatewayRoom(core: RealtimeCore, auth: SyntheticAuth) {
  return class GatewayRoom extends Room {
    onCreate(): void {
      this.maxClients = 2000;
      this.autoDispose = false;
      this.onMessageBytes("m2", (client, bytes: Uint8Array) => {
        void core.handle(client.sessionId, bytes);
      });
    }

    onAuth(_client: Client, options: { token?: unknown }): SyntheticIdentity {
      return auth.authenticate(options?.token);
    }

    onJoin(
      client: Client,
      _options: unknown,
      identity: SyntheticIdentity,
    ): void {
      core.addSession(client.sessionId, identity, {
        send: (bytes) => client.sendBytes("m2", bytes),
        close: (reason) => client.leave(4000, reason),
        bufferedBytes: () =>
          (client.ref as { bufferedAmount?: number }).bufferedAmount ?? 0,
      });
    }

    onLeave(client: Client): void {
      core.removeSession(client.sessionId);
    }
  };
}

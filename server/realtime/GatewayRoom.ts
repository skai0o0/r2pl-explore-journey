import { type Client, Room } from "@colyseus/core";
import type { OutboundSink } from "./OutboundQueue.ts";
import type { SyntheticAuth, SyntheticIdentity } from "./SyntheticAuth.ts";

/** Thin Colyseus adapter for either explicit synthetic authority. */
export interface GatewayCore {
  handle(sessionId: string, bytes: Uint8Array): Promise<void>;
  addSession(
    sessionId: string,
    identity: SyntheticIdentity,
    sink: OutboundSink,
  ): void;
  removeSession(sessionId: string): void;
}

export function createGatewayRoom(core: GatewayCore, auth: SyntheticAuth) {
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

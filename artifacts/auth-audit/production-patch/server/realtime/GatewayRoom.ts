import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import type { OutboundSink } from "./OutboundQueue.ts";
import type { SyntheticIdentity } from "./SyntheticAuth.ts";

export interface GatewayAuth {
  authenticate(token: unknown): SyntheticIdentity | Promise<SyntheticIdentity>;
  readonly revalidate?: boolean;
  validate?(identity: SyntheticIdentity): Promise<void>;
}

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

export function createGatewayRoom(core: GatewayCore, auth: GatewayAuth) {
  return class GatewayRoom extends Room {
    // Authenticate before matchmaking can allocate rooms or reserve seats.
    static override async onAuth(
      _token: string,
      options: { token?: unknown },
    ): Promise<SyntheticIdentity> {
      try {
        return await auth.authenticate(options?.token);
      } catch {
        throw new ServerError(ErrorCode.AUTH_FAILED, "UNAUTHORIZED");
      }
    }
    onCreate(): void {
      this.maxClients = 2000;
      this.autoDispose = false;
      if (!auth.revalidate)
        this.onMessageBytes("m2", (client, bytes: Uint8Array) => {
          void core.handle(client.sessionId, bytes);
        });
      if (auth.revalidate) {
        this.onMessageBytes("m2", (client, bytes: Uint8Array) => {
          void Promise.resolve(auth.validate!(client.auth as SyntheticIdentity))
            .then(() => core.handle(client.sessionId, bytes))
            .catch(() => client.leave(4001, "Session expired"));
        });
        this.clock.setInterval(() => {
          for (const client of this.clients) {
            void Promise.resolve(
              auth.validate!(client.auth as SyntheticIdentity),
            ).catch(() => client.leave(4001, "Session expired"));
          }
        }, GAME_CONFIG.integration.sessionRecheckMs);
      }
    }

    async onJoin(
      client: Client,
      _options: unknown,
      identity: SyntheticIdentity,
    ): Promise<void> {
      // A session can expire or be revoked between HTTP reservation and WS join.
      if (auth.revalidate) await auth.validate!(identity);
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

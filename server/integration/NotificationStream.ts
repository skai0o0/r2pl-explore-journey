import type { ServerResponse } from "node:http";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import type { NotificationStore } from "./NotificationStore.ts";

interface Peer {
  response: ServerResponse;
  since: string;
  slot: number;
  authenticate: () => Promise<{ schoolSlot: number } | undefined>;
  lastCheck: number;
}
/** Live-only SSE. A new/reconnected subscriber starts at the committed head, never backlog. */
export class NotificationStream {
  private peers = new Set<Peer>();
  private cursor = "0";
  private busy = false;
  private timer: ReturnType<typeof setInterval>;
  private store: NotificationStore;
  constructor(store: NotificationStore) {
    this.store = store;
    this.timer = setInterval(
      () => void this.tick(),
      GAME_CONFIG.notifications.streamPollMs,
    );
    this.timer.unref();
  }
  async open(
    response: ServerResponse,
    slot: number,
    authenticate: Peer["authenticate"],
  ): Promise<void> {
    const since = await this.store.cursor();
    if (!this.peers.size) this.cursor = since;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    const peer: Peer = { response, since, slot, authenticate, lastCheck: 0 };
    this.peers.add(peer);
    response.on("close", () => this.peers.delete(peer));
  }
  private async tick(): Promise<void> {
    if (this.busy || !this.peers.size) return;
    this.busy = true;
    try {
      const page = await this.store.liveAfter(this.cursor);
      this.cursor = page.cursor;
      for (const peer of [...this.peers]) {
        if (
          Date.now() - peer.lastCheck >=
          GAME_CONFIG.integration.sessionRecheckMs
        ) {
          const actor = await peer.authenticate();
          if (!actor || actor.schoolSlot !== peer.slot) {
            peer.response.end();
            this.peers.delete(peer);
            continue;
          }
          peer.lastCheck = Date.now();
        }
        let alive = true;
        for (const event of page.events) {
          if (
            BigInt(event.id) <= BigInt(peer.since) ||
            (event.schoolSlot !== null && event.schoolSlot !== peer.slot)
          )
            continue;
          if (
            !peer.response.write(
              `event: notification\ndata: ${JSON.stringify(event)}\n\n`,
            )
          ) {
            alive = false;
            break;
          }
        }
        if (!alive) {
          peer.response.destroy();
          this.peers.delete(peer);
        } else if (!peer.response.write(": heartbeat\n\n")) {
          peer.response.destroy();
          this.peers.delete(peer);
        }
      }
    } catch {
      for (const p of this.peers) p.response.end();
      this.peers.clear();
    } finally {
      this.busy = false;
    }
  }
  close(): void {
    clearInterval(this.timer);
    for (const peer of this.peers) peer.response.end();
    this.peers.clear();
  }
}

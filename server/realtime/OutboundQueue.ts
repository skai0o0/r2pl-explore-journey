import { performance } from "node:perf_hooks";
import { M2_KIND } from "../../shared/protocol/m2.ts";
import type { RealtimeMetrics } from "./metrics.ts";

export interface OutboundSink {
  send(bytes: Uint8Array): void | Promise<void>;
  close(reason: string): void;
  bufferedBytes?(): number;
}
interface Item {
  readonly bytes: Uint8Array;
  readonly enqueuedAt: number;
  readonly valid?: () => boolean;
  readonly onSinkSendResolved?: () => void;
}

/** Ordered per-client queue with a hard in-process and underlying-socket budget. */
export class OutboundQueue {
  readonly #sink: OutboundSink;
  readonly #metrics: RealtimeMetrics;
  readonly #maxFrames: number;
  readonly #maxBytes: number;
  readonly #items: Item[] = [];
  #bytes = 0;
  #draining = false;
  #closed = false;

  constructor(
    sink: OutboundSink,
    metrics: RealtimeMetrics,
    maxFrames = 128,
    maxBytes = 1_048_576,
  ) {
    this.#sink = sink;
    this.#metrics = metrics;
    this.#maxFrames = maxFrames;
    this.#maxBytes = maxBytes;
  }

  get queuedBytes(): number {
    return this.#bytes;
  }
  get queuedFrames(): number {
    return this.#items.length;
  }
  get closed(): boolean {
    return this.#closed;
  }

  enqueue(
    bytes: Uint8Array,
    valid?: () => boolean,
    onSinkSendResolved?: () => void,
  ): boolean {
    if (this.#closed) return false;
    this.#metrics.observe(
      "socket_buffered_bytes",
      this.#sink.bufferedBytes?.() ?? 0,
    );
    if (
      this.#items.length >= this.#maxFrames ||
      this.#bytes + bytes.byteLength > this.#maxBytes ||
      (this.#sink.bufferedBytes?.() ?? 0) > this.#maxBytes
    ) {
      this.close("slow_client");
      this.#metrics.count("slow_client_disconnects");
      return false;
    }
    this.#items.push({
      bytes: Uint8Array.from(bytes),
      enqueuedAt: performance.now(),
      ...(valid ? { valid } : {}),
      ...(onSinkSendResolved ? { onSinkSendResolved } : {}),
    });
    this.#bytes += bytes.byteLength;
    this.#metrics.observe("outbound_queue_depth", this.#items.length);
    if (!this.#draining) {
      this.#draining = true;
      queueMicrotask(() => {
        void this.#drain();
      });
    }
    return true;
  }

  close(reason = "closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#items.length = 0;
    this.#bytes = 0;
    this.#sink.close(reason);
  }

  async #drain(): Promise<void> {
    try {
      while (!this.#closed && this.#items.length) {
        const item = this.#items.shift()!;
        this.#bytes -= item.bytes.byteLength;
        if (item.valid && !item.valid()) continue;
        await this.#sink.send(item.bytes);
        item.onSinkSendResolved?.();
        if (item.bytes[3] === M2_KIND.DELTA)
          this.#metrics.observe(
            "delta_delivery_ms",
            performance.now() - item.enqueuedAt,
          );
        if (item.bytes[3] === M2_KIND.ACK)
          this.#metrics.observe(
            "ack_delivery_ms",
            performance.now() - item.enqueuedAt,
          );
        this.#metrics.count("outbound_frames");
        this.#metrics.count("outbound_bytes", item.bytes.byteLength);
      }
    } catch {
      this.close("send_failed");
      this.#metrics.count("outbound_send_failures");
    } finally {
      this.#draining = false;
      if (!this.#closed && this.#items.length) {
        this.#draining = true;
        queueMicrotask(() => {
          void this.#drain();
        });
      }
    }
  }
}

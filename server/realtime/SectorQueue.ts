import { performance } from "node:perf_hooks";
import { SECTOR_COUNT } from "../../shared/world/constants.ts";
import type { RealtimeMetrics } from "./metrics.ts";

class SerialSectorQueue {
  readonly #metrics: RealtimeMetrics;
  readonly #maxDepth: number;
  #tail: Promise<void> = Promise.resolve();
  #depth = 0;

  constructor(metrics: RealtimeMetrics, maxDepth: number) {
    this.#metrics = metrics;
    this.#maxDepth = maxDepth;
  }
  get depth(): number {
    return this.#depth;
  }

  enqueue<T>(
    operation: () => T | Promise<T>,
    kind?: "command" | "snapshot" | "relay",
  ): Promise<T> {
    if (this.#depth >= this.#maxDepth) {
      this.#metrics.count("sector_queue_rejected");
      return Promise.reject(new Error("Sector queue full"));
    }
    const queuedAt = performance.now();
    this.#depth++;
    this.#metrics.observe("sector_queue_depth", this.#depth);
    const task = this.#tail.then(async () => {
      const waited = performance.now() - queuedAt;
      this.#metrics.observe("sector_queue_wait_ms", waited);
      if (kind) this.#metrics.observe(`sector_${kind}_queue_wait_ms`, waited);
      const start = performance.now();
      try {
        return await operation();
      } finally {
        const executed = performance.now() - start;
        this.#metrics.observe("sector_execute_ms", executed);
        if (kind) this.#metrics.observe(`sector_${kind}_execute_ms`, executed);
        this.#depth--;
      }
    });
    this.#tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
}

export class SectorQueues {
  readonly #queues: readonly SerialSectorQueue[];
  constructor(metrics: RealtimeMetrics, maxDepth = 4096) {
    this.#queues = Array.from(
      { length: SECTOR_COUNT },
      () => new SerialSectorQueue(metrics, maxDepth),
    );
  }
  enqueue<T>(
    sectorId: number,
    operation: () => T | Promise<T>,
    kind?: "command" | "snapshot" | "relay",
  ): Promise<T> {
    const queue = this.#queues[sectorId];
    if (!queue) throw new RangeError("Invalid sector id");
    return queue.enqueue(operation, kind);
  }
  depths(): number[] {
    return this.#queues.map((queue) => queue.depth);
  }
}

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

  enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.#depth >= this.#maxDepth) {
      this.#metrics.count("sector_queue_rejected");
      return Promise.reject(new Error("Sector queue full"));
    }
    const queuedAt = performance.now();
    this.#depth++;
    this.#metrics.observe("sector_queue_depth", this.#depth);
    const task = this.#tail.then(async () => {
      this.#metrics.observe(
        "sector_queue_wait_ms",
        performance.now() - queuedAt,
      );
      const start = performance.now();
      try {
        return await operation();
      } finally {
        this.#metrics.observe("sector_execute_ms", performance.now() - start);
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
  enqueue<T>(sectorId: number, operation: () => T | Promise<T>): Promise<T> {
    const queue = this.#queues[sectorId];
    if (!queue) throw new RangeError("Invalid sector id");
    return queue.enqueue(operation);
  }
  depths(): number[] {
    return this.#queues.map((queue) => queue.depth);
  }
}

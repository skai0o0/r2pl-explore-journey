export interface MetricSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}
export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, MetricSummary>>;
}

/** Bounded M2 in-process measurements; durations are milliseconds. */
export class RealtimeMetrics {
  readonly #counters = new Map<string, number>();
  readonly #samples = new Map<string, number[]>();
  readonly #sampleLimit: number;

  constructor(sampleLimit = 100_000) {
    this.#sampleLimit = sampleLimit;
  }
  count(name: string, amount = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + amount);
  }
  observe(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Invalid metric sample");
    const samples = this.#samples.get(name) ?? [];
    if (samples.length < this.#sampleLimit) samples.push(value);
    this.#samples.set(name, samples);
  }
  snapshot(): MetricsSnapshot {
    const histograms: Record<string, MetricSummary> = {};
    for (const [name, samples] of this.#samples) {
      const sorted = [...samples].sort((a, b) => a - b);
      const pick = (fraction: number) =>
        sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
      histograms[name] = {
        count: samples.length,
        p50: pick(0.5),
        p95: pick(0.95),
        p99: pick(0.99),
        max: sorted.at(-1) ?? 0,
      };
    }
    return { counters: Object.fromEntries(this.#counters), histograms };
  }
}

export interface StructuredLogger {
  log(event: Readonly<Record<string, string | number | boolean>>): void;
}
export const silentLogger: StructuredLogger = { log: () => {} };
export const jsonLogger: StructuredLogger = {
  log: (event) =>
    console.log(
      JSON.stringify({ timestamp: new Date().toISOString(), ...event }),
    ),
};

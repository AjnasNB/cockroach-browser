export interface ResourceSamplePoint {
  rssBytes: number;
  cpuTimeMs: number;
  processCount: number;
}

export interface ContinuousResourceSamplerOptions<T extends ResourceSamplePoint> {
  sample: () => Promise<T>;
  intervalMs: number;
  onSample?: (sample: T) => void;
}

export interface ContinuousResourcePeak<T extends ResourceSamplePoint> {
  samples: readonly T[];
  sampleCount: number;
  peakRssBytes: number;
  cpuTimeMs: number;
  processCount: number;
}

/**
 * Serial continuous sampling for benchmark harnesses. Slow operating-system
 * samples never overlap, and telemetry errors remain explicit.
 */
export class ContinuousResourceSampler<T extends ResourceSamplePoint> {
  readonly intervalMs: number;
  readonly #sample: () => Promise<T>;
  readonly #onSample: ((sample: T) => void) | undefined;
  readonly #samples: T[] = [];
  #tail: Promise<void> = Promise.resolve();
  #timer?: NodeJS.Timeout;
  #started = false;
  #stopped = false;
  #failure?: unknown;

  constructor(options: ContinuousResourceSamplerOptions<T>) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 25 || options.intervalMs > 60_000) {
      throw new RangeError("Continuous resource sampling interval must be between 25 and 60000 milliseconds.");
    }
    this.intervalMs = options.intervalMs;
    this.#sample = options.sample;
    this.#onSample = options.onSample;
  }

  start(): void {
    if (this.#started) throw new Error("Continuous resource sampling has already started.");
    this.#started = true;
    this.#runTick();
  }

  async sampleNow(): Promise<void> {
    if (!this.#started || this.#stopped) throw new Error("Continuous resource sampling is not active.");
    await this.#enqueue();
    if (this.#failure !== undefined) throw this.#failure;
  }

  async stop(): Promise<ContinuousResourcePeak<T>> {
    if (!this.#started) throw new Error("Continuous resource sampling has not started.");
    if (!this.#stopped) {
      this.#stopped = true;
      if (this.#timer) clearTimeout(this.#timer);
      await this.#tail;
      if (this.#failure === undefined) await this.#enqueue();
    }
    await this.#tail;
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#samples.length === 0) throw new Error("Continuous resource sampling returned no samples.");
    const samples = Object.freeze(this.#samples.map((sample) => Object.freeze({ ...sample }) as T));
    return Object.freeze({
      samples,
      sampleCount: samples.length,
      peakRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
      cpuTimeMs: Math.max(...samples.map((sample) => sample.cpuTimeMs)),
      processCount: Math.max(...samples.map((sample) => sample.processCount))
    });
  }

  #runTick(): void {
    const operation = this.#enqueue();
    void operation.catch(() => undefined).finally(() => {
      if (this.#stopped || this.#failure !== undefined) return;
      this.#timer = setTimeout(() => this.#runTick(), this.intervalMs);
      this.#timer.unref();
    });
  }

  #enqueue(): Promise<void> {
    const operation = this.#tail.then(async () => {
      if (this.#failure !== undefined) return;
      const sample = await this.#sample();
      assertSample(sample);
      this.#samples.push(sample);
      this.#onSample?.(sample);
    });
    this.#tail = operation.catch((error) => {
      this.#failure ??= error;
    });
    return operation;
  }
}

function assertSample(sample: ResourceSamplePoint): void {
  if (
    !Number.isFinite(sample.rssBytes) || sample.rssBytes < 0
    || !Number.isFinite(sample.cpuTimeMs) || sample.cpuTimeMs < 0
    || !Number.isSafeInteger(sample.processCount) || sample.processCount < 0
  ) {
    throw new TypeError("Resource samples require finite non-negative RSS/CPU values and an integer process count.");
  }
}

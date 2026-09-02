import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousResourceSampler } from "../src/continuous-resource-sampler.js";

test("continuous sampler serializes ticks and returns complete maxima", async () => {
  const values = [
    { rssBytes: 10, cpuTimeMs: 1, processCount: 1 },
    { rssBytes: 30, cpuTimeMs: 4, processCount: 2 },
    { rssBytes: 20, cpuTimeMs: 8, processCount: 1 }
  ];
  let index = 0;
  let active = 0;
  let maximumActive = 0;
  const observed: number[] = [];
  const sampler = new ContinuousResourceSampler({
    intervalMs: 25,
    sample: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      const result = values[Math.min(index, values.length - 1)]!;
      index += 1;
      active -= 1;
      return result;
    },
    onSample: (sample) => observed.push(sample.rssBytes)
  });
  sampler.start();
  await sampler.sampleNow();
  await sampler.sampleNow();
  const peak = await sampler.stop();
  assert.equal(maximumActive, 1);
  assert.ok(peak.sampleCount >= 3);
  assert.equal(peak.peakRssBytes, 30);
  assert.equal(peak.cpuTimeMs, 8);
  assert.equal(peak.processCount, 2);
  assert.deepEqual(observed, peak.samples.map((sample) => sample.rssBytes));
});

test("continuous sampler fails explicitly on invalid or failed telemetry", async () => {
  const invalid = new ContinuousResourceSampler({
    intervalMs: 25,
    sample: async () => ({ rssBytes: Number.NaN, cpuTimeMs: 0, processCount: 1 })
  });
  invalid.start();
  await assert.rejects(invalid.stop(), /finite non-negative/);

  const failed = new ContinuousResourceSampler({
    intervalMs: 25,
    sample: async () => { throw new Error("collector unavailable"); }
  });
  failed.start();
  await assert.rejects(failed.stop(), /collector unavailable/);
  assert.throws(
    () => new ContinuousResourceSampler({ intervalMs: 0, sample: async () => ({ rssBytes: 0, cpuTimeMs: 0, processCount: 0 }) }),
    /between 25 and 60000/
  );
});

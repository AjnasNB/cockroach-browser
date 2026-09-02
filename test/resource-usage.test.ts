import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BrowserResourceTracker, aggregateProcessTree, unavailableResourceUsage } from "../src/resource-usage.js";

test("aggregates only the owned process tree", () => {
  const sample = aggregateProcessTree(10, [
    { pid: 10, parentPid: 1, rssBytes: 100, cpuTimeMs: 5 },
    { pid: 11, parentPid: 10, rssBytes: 200, cpuTimeMs: 6 },
    { pid: 12, parentPid: 11, rssBytes: 300, cpuTimeMs: 7 },
    { pid: 20, parentPid: 1, rssBytes: 10_000, cpuTimeMs: 500 }
  ]);

  assert.equal(sample.rootPid, 10);
  assert.equal(sample.processCount, 3);
  assert.equal(sample.rssBytes, 600);
  assert.equal(sample.cpuTimeMs, 18);
});

test("tracks peaks, caches samples, and reports resource limit breaches", async () => {
  let calls = 0;
  const tracker = new BrowserResourceTracker({
    rootPid: 42,
    budget: { maxProcessRssBytes: 500, maxProcessCpuTimeMs: 100 },
    sampleIntervalMs: 1_000,
    sampler: async (rootPid) => {
      calls += 1;
      return {
        rootPid,
        sampledAt: `2026-09-02T00:00:0${calls}.000Z`,
        processCount: 2,
        rssBytes: calls === 1 ? 400 : 600,
        cpuTimeMs: calls === 1 ? 20 : 40
      };
    }
  });

  const first = await tracker.sample();
  const cached = await tracker.sample();
  const exceeded = await tracker.sample(true);

  assert.equal(calls, 2);
  assert.equal(first.limitState, "within");
  assert.deepEqual(cached, first);
  assert.equal(exceeded.limitState, "exceeded");
  assert.equal(exceeded.peakRssBytes, 600);
  assert.equal(exceeded.peakCpuTimeMs, 40);
});

test("coalesces concurrent operating-system samples", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tracker = new BrowserResourceTracker({
    rootPid: 42,
    budget: { maxProcessRssBytes: 500, maxProcessCpuTimeMs: 100 },
    sampler: async (rootPid) => {
      calls += 1;
      await gate;
      return {
        rootPid,
        sampledAt: "2026-09-02T00:00:00.000Z",
        processCount: 1,
        rssBytes: 50,
        cpuTimeMs: 10
      };
    }
  });

  const first = tracker.sample(true);
  const second = tracker.sample(true);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
});

test("resource sampling failures remain explicit instead of becoming zero usage", async () => {
  const tracker = new BrowserResourceTracker({
    rootPid: 42,
    budget: { maxProcessRssBytes: 500, maxProcessCpuTimeMs: 100 },
    sampler: async () => {
      throw new Error("process exited");
    }
  });

  const usage = await tracker.sample(true);
  assert.equal(usage.available, false);
  assert.equal(usage.limitState, "unavailable");
  assert.match(usage.reason ?? "", /process exited/);

  const external = unavailableResourceUsage(
    { maxProcessRssBytes: 500, maxProcessCpuTimeMs: 100 },
    "customer owned"
  );
  assert.equal(external.ownership, "external");
  assert.equal(external.rssBytes, undefined);
});

test("rejects missing process roots and unsafe sample intervals", () => {
  assert.throws(() => aggregateProcessTree(9, []), /no longer running/);
  assert.throws(
    () => new BrowserResourceTracker({
      rootPid: 42,
      budget: { maxProcessRssBytes: 500, maxProcessCpuTimeMs: 100 },
      sampleIntervalMs: 100
    }),
    /between 250 and 60000/
  );
});

test("the public session schema exposes every configurable resource ceiling", async () => {
  const schema = JSON.parse(await readFile("schemas/session.schema.json", "utf8")) as {
    $defs: { policy: { properties: { budget: { properties: Record<string, unknown> } } } };
  };
  const properties = schema.$defs.policy.properties.budget.properties;
  for (const name of [
    "maxProcessRssBytes",
    "maxProcessCpuTimeMs",
    "maxNetworkEntries",
    "maxClipboardBytes",
    "maxSavedStates"
  ]) {
    assert.ok(properties[name], `${name} must be represented in the public session schema`);
  }
});

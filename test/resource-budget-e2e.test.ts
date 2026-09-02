import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserRuntime } from "../src/runtime.js";

test("rejects unknown browser engines and performance profiles before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-resource-enums-"));
  const runtime = new BrowserRuntime({ root });
  try {
    await assert.rejects(
      runtime.createSession({
        engine: "unknown" as never,
        purpose: "Reject an unknown browser engine",
        policy: { allowedOrigins: ["https://example.com"] }
      }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BROWSER_ENGINE_INVALID")
    );
    await assert.rejects(
      runtime.createSession({
        performanceProfile: "turbo" as never,
        purpose: "Reject an unknown performance profile",
        policy: { allowedOrigins: ["https://example.com"] }
      }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "PERFORMANCE_PROFILE_INVALID")
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "a 20 MiB browser ceiling fails closed instead of making an impossible claim",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-20mib-"));
    const runtime = new BrowserRuntime({ root });
    try {
      await assert.rejects(
        runtime.createSession({
          purpose: "Verify the deliberately undersized browser memory ceiling",
          policy: {
            allowedOrigins: ["https://example.com"],
            budget: { maxProcessRssBytes: 20 * 1024 * 1024 }
          }
        }),
        (error: unknown) => Boolean(
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "PROCESS_RSS_BUDGET_EXCEEDED"
        )
      );
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "a monitored resource breach remains the terminal session result",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-terminal-resource-"));
    let samples = 0;
    let resourceEvents = 0;
    let resolveBreach!: () => void;
    const breach = new Promise<void>((resolve) => { resolveBreach = resolve; });
    const runtime = new BrowserRuntime({
      root,
      resourceSampleIntervalMs: 250,
      processTreeSampler: async (rootPid) => {
        samples += 1;
        if (samples >= 3) throw new Error("browser process exited");
        if (samples === 2) await new Promise((resolve) => setTimeout(resolve, 800));
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: samples === 1 ? 100 : 1_000,
          cpuTimeMs: 1
        };
      },
      eventPublisher: {
        async publish(event) {
          if (event.type === "browser.session.resource-limit-exceeded") {
            resourceEvents += 1;
            resolveBreach();
          }
        }
      }
    });
    try {
      const created = await runtime.createSession({
        purpose: "Preserve the detected browser resource breach",
        policy: {
          allowedOrigins: ["https://example.com"],
          budget: { maxProcessRssBytes: 500 }
        }
      });
      let timeout!: NodeJS.Timeout;
      try {
        await Promise.race([
          breach,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("resource monitor timed out")), 5_000);
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }

      const terminal = await runtime.session(created.id);
      assert.equal(terminal.state, "failed");
      assert.equal(terminal.resources.available, true);
      assert.equal(terminal.resources.limitState, "exceeded");
      assert.equal(terminal.resources.rssBytes, 1_000);
      assert.equal(samples, 2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(resourceEvents, 1);
      await assert.rejects(
        runtime.act(created.id, { kind: "snapshot", purpose: "Reject work after the resource breach" }),
        (error: unknown) => Boolean(
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "PROCESS_RSS_BUDGET_EXCEEDED"
        )
      );
      await runtime.closeSession(created.id);
      await assert.rejects(
        runtime.session(created.id),
        (error: unknown) => Boolean(
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "SESSION_NOT_FOUND"
        )
      );
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

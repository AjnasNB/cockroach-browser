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

test("validates context-recorder deadlines before runtime use", () => {
  for (const contextRecorderTimeoutMs of [Number.NaN, 0, 120_001, 1.5]) {
    assert.throws(
      () => new BrowserRuntime({ contextRecorderTimeoutMs }),
      (error: unknown) => Boolean(
        error && typeof error === "object" && "code" in error && error.code === "CONTEXT_RECORDER_TIMEOUT_INVALID"
      )
    );
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

test(
  "runtime-owned resource telemetry fails closed when sampling disappears",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-telemetry-loss-"));
    let samples = 0;
    let resolveFailure!: () => void;
    const failure = new Promise<void>((resolve) => { resolveFailure = resolve; });
    const runtime = new BrowserRuntime({
      root,
      resourceSampleIntervalMs: 250,
      processTreeSampler: async (rootPid) => {
        samples += 1;
        if (samples > 1) throw new Error("fixture sampler unavailable");
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: 1_024,
          cpuTimeMs: 1
        };
      },
      eventPublisher: {
        async publish(event) {
          if (
            event.type === "browser.session.resource-limit-exceeded"
            && event.metadata?.errorCode === "PROCESS_RESOURCE_TELEMETRY_UNAVAILABLE"
          ) resolveFailure();
        }
      }
    });
    try {
      const created = await runtime.createSession({
        purpose: "Fail closed when owned process telemetry disappears",
        policy: {
          allowedOrigins: ["https://example.com"],
          allowedActions: ["snapshot"]
        }
      });
      await Promise.race([
        failure,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("telemetry failure timed out")), 5_000))
      ]);
      assert.equal((await runtime.session(created.id)).state, "failed");
      await assert.rejects(
        runtime.act(created.id, { kind: "snapshot", purpose: "Prove the terminal failure is sticky" }),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error
          && error.code === "PROCESS_RESOURCE_TELEMETRY_UNAVAILABLE"
        )
      );
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "duration and Qarinah integration failures cannot leave an unbounded or falsely failed action",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-duration-context-"));
    let resolveExpiry!: () => void;
    const expired = new Promise<void>((resolve) => { resolveExpiry = resolve; });
    const runtime = new BrowserRuntime({
      root,
      contextRecorder: {
        async record() {
          throw new Error("fixture Qarinah outage");
        }
      },
      eventPublisher: {
        async publish(event) {
          if (event.type === "browser.session.duration-limit-exceeded") resolveExpiry();
        }
      }
    });
    try {
      const created = await runtime.createSession({
        purpose: "Enforce wall-clock expiry independently of action boundaries",
        policy: {
          allowedOrigins: ["https://example.com"],
          allowedActions: ["snapshot"],
          budget: { maxDurationMs: 5_000 }
        }
      });
      const action = await runtime.act(created.id, {
        kind: "snapshot",
        purpose: "Prove a Qarinah outage does not rewrite a successful browser action"
      });
      assert.equal(action.receipt.status, "succeeded");
      assert.equal(
        runtime.activities({ sessionId: created.id }).some((event) => event.type === "browser.context.recording-failed"),
        true
      );
      await Promise.race([
        expired,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("duration expiry timed out")), 10_000))
      ]);
      assert.equal((await runtime.session(created.id)).state, "failed");
      await assert.rejects(
        runtime.act(created.id, { kind: "snapshot", purpose: "Prove duration expiry is terminal" }),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "DURATION_BUDGET_EXCEEDED"
        )
      );
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "a rejected profile-saving close keeps resource enforcement armed",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-close-monitor-"));
    let samples = 0;
    let resourceEvents = 0;
    let resolveBreach!: () => void;
    const breach = new Promise<void>((resolve) => { resolveBreach = resolve; });
    const runtime = new BrowserRuntime({
      root,
      resourceSampleIntervalMs: 250,
      processTreeSampler: async (rootPid) => {
        samples += 1;
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: samples <= 2 ? 100 : 1_000,
          cpuTimeMs: samples
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
        profile: "resource-close-regression",
        profilePassphrase: "a-strong-resource-profile-passphrase",
        purpose: "Keep enforcement active after a rejected profile checkpoint",
        policy: {
          allowedOrigins: ["https://example.com"],
          budget: { maxProcessRssBytes: 500 }
        }
      });

      await assert.rejects(
        runtime.closeSession(created.id, { saveProfile: true }),
        (error: unknown) => Boolean(
          error
          && typeof error === "object"
          && "code" in error
          && error.code === "PROFILE_PASSPHRASE_REQUIRED"
        )
      );

      let timeout!: NodeJS.Timeout;
      try {
        await Promise.race([
          breach,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("resource monitor did not recover after rejected close")), 5_000);
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }

      const terminal = await runtime.session(created.id);
      assert.equal(terminal.state, "failed");
      assert.equal(terminal.resources.limitState, "exceeded");
      assert.equal(terminal.resources.rssBytes, 1_000);
      assert.ok(samples >= 3);
      assert.equal(resourceEvents, 1);
      await runtime.closeSession(created.id);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "wall-clock expiry tears down the owned browser before a never-resolving lifecycle publisher",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-duration-publisher-"));
    const neverDelivered = new Promise<void>(() => undefined);
    let browserPid: number | undefined;
    let runningAtTerminalDelivery: boolean | undefined;
    let signalTerminalDelivery!: () => void;
    const terminalDelivery = new Promise<void>((resolve) => { signalTerminalDelivery = resolve; });
    const runtime = new BrowserRuntime({
      root,
      eventPublisherTimeoutMs: 25,
      resourceSampleIntervalMs: 60_000,
      processTreeSampler: async (rootPid) => {
        browserPid = rootPid;
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: 1_024,
          cpuTimeMs: 1
        };
      },
      eventPublisher: {
        publish(event) {
          if (event.type === "browser.session.duration-limit-exceeded") {
            runningAtTerminalDelivery = browserPid === undefined ? undefined : processIsRunning(browserPid);
            signalTerminalDelivery();
          }
          return neverDelivered;
        }
      }
    });
    try {
      const created = await runtime.createSession({
        purpose: "Terminate an owned browser at the exact wall-clock ceiling",
        policy: {
          allowedOrigins: ["https://example.com"],
          allowedActions: ["snapshot"],
          budget: { maxDurationMs: 2_000 }
        }
      });

      await settleWithin(terminalDelivery, 5_000, "duration terminal delivery did not begin");
      assert.equal(runningAtTerminalDelivery, false);
      assert.equal((await runtime.session(created.id)).state, "failed");
      await assert.rejects(
        settleWithin(
          runtime.act(created.id, { kind: "snapshot", purpose: "Prove wall-clock expiry remains terminal" }),
          1_000,
          "sticky duration failure was blocked by lifecycle delivery"
        ),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "DURATION_BUDGET_EXCEEDED"
        )
      );
      await settleWithin(runtime.closeSession(created.id), 1_000, "session cleanup was blocked by lifecycle delivery");
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "resource expiry tears down the owned browser before a never-resolving lifecycle publisher",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-resource-publisher-"));
    const neverDelivered = new Promise<void>(() => undefined);
    let samples = 0;
    let browserPid: number | undefined;
    let runningAtTerminalDelivery: boolean | undefined;
    let signalTerminalDelivery!: () => void;
    const terminalDelivery = new Promise<void>((resolve) => { signalTerminalDelivery = resolve; });
    const runtime = new BrowserRuntime({
      root,
      eventPublisherTimeoutMs: 25,
      resourceSampleIntervalMs: 250,
      processTreeSampler: async (rootPid) => {
        samples += 1;
        browserPid = rootPid;
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: samples === 1 ? 100 : 1_000,
          cpuTimeMs: samples
        };
      },
      eventPublisher: {
        publish(event) {
          if (event.type === "browser.session.resource-limit-exceeded") {
            runningAtTerminalDelivery = browserPid === undefined ? undefined : processIsRunning(browserPid);
            signalTerminalDelivery();
          }
          return neverDelivered;
        }
      }
    });
    try {
      const created = await runtime.createSession({
        purpose: "Terminate an owned browser at the sampled RSS ceiling",
        policy: {
          allowedOrigins: ["https://example.com"],
          allowedActions: ["snapshot"],
          budget: { maxProcessRssBytes: 500 }
        }
      });

      await settleWithin(terminalDelivery, 5_000, "resource terminal delivery did not begin");
      assert.equal(runningAtTerminalDelivery, false);
      const terminal = await runtime.session(created.id);
      assert.equal(terminal.state, "failed");
      assert.equal(terminal.resources.limitState, "exceeded");
      await assert.rejects(
        settleWithin(
          runtime.act(created.id, { kind: "snapshot", purpose: "Prove the sampled RSS breach remains terminal" }),
          1_000,
          "sticky resource failure was blocked by lifecycle delivery"
        ),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "PROCESS_RSS_BUDGET_EXCEEDED"
        )
      );
      await settleWithin(runtime.closeSession(created.id), 1_000, "session cleanup was blocked by lifecycle delivery");
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "a never-resolving context recorder cannot block actions or close cleanup",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-context-deadline-"));
    const neverRecorded = new Promise<void>(() => undefined);
    const runtime = new BrowserRuntime({
      root,
      contextRecorderTimeoutMs: 25,
      contextRecorder: { record: () => neverRecorded }
    });
    try {
      const created = await settleWithin(runtime.createSession({
        purpose: "Keep browser work independent from a stalled context sink",
        policy: { allowedOrigins: ["https://example.com"], allowedActions: ["snapshot"] }
      }), 5_000, "session creation was blocked by context recording");
      const action = await settleWithin(runtime.act(created.id, {
        kind: "snapshot",
        purpose: "Complete an action while context recording is stalled"
      }), 2_000, "browser action was blocked by context recording");
      assert.equal(action.receipt.status, "succeeded");
      await settleWithin(runtime.closeSession(created.id), 2_000, "session close was blocked by context recording");
      assert.ok(
        runtime.activities({ sessionId: created.id })
          .filter((event) => event.type === "browser.context.recording-failed").length >= 3
      );
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "action-boundary resource samples terminalize immediately despite a 60-second monitor",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async (t) => {
    for (const scenario of [
      { name: "breach", code: "PROCESS_RSS_BUDGET_EXCEEDED", unavailable: false },
      { name: "unavailable", code: "PROCESS_RESOURCE_TELEMETRY_UNAVAILABLE", unavailable: true }
    ] as const) {
      await t.test(scenario.name, async () => {
        const root = await mkdtemp(join(tmpdir(), `cockroach-browser-boundary-${scenario.name}-`));
        let samples = 0;
        let browserPid: number | undefined;
        const runtime = new BrowserRuntime({
          root,
          resourceSampleIntervalMs: 60_000,
          processTreeSampler: async (rootPid) => {
            samples += 1;
            browserPid = rootPid;
            if (scenario.unavailable && samples === 2) throw new Error("fixture telemetry outage");
            return {
              sampledAt: new Date().toISOString(),
              rootPid,
              processCount: 1,
              rssBytes: samples === 2 ? 1_000 : 100,
              cpuTimeMs: samples
            };
          }
        });
        try {
          const created = await runtime.createSession({
            purpose: `Terminalize an immediate ${scenario.name} resource sample`,
            policy: {
              allowedOrigins: ["https://example.com"],
              allowedActions: ["snapshot"],
              budget: { maxProcessRssBytes: 500 }
            }
          });
          await assert.rejects(
            settleWithin(runtime.act(created.id, {
              kind: "snapshot",
              purpose: `Detect the immediate ${scenario.name} sample`
            }), 2_000, "action-boundary terminalization timed out"),
            (error: unknown) => Boolean(
              error && typeof error === "object" && "code" in error && error.code === scenario.code
            )
          );
          assert.equal(samples, 2);
          assert.equal(browserPid === undefined ? undefined : processIsRunning(browserPid), false);
          assert.equal((await runtime.session(created.id)).state, "failed");
          await assert.rejects(
            runtime.act(created.id, { kind: "snapshot", purpose: "Prove the terminal result remains sticky" }),
            (error: unknown) => Boolean(
              error && typeof error === "object" && "code" in error && error.code === scenario.code
            )
          );
          assert.equal(samples, 2);
          await runtime.closeSession(created.id);
        } finally {
          await runtime.close();
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
);

test(
  "an unverified owned close retains the failed session until a successful retry",
  { skip: process.env.COCKROACH_BROWSER_RESOURCE_E2E !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-termination-retry-"));
    let attempts = 0;
    let browserPid: number | undefined;
    const runtime = new BrowserRuntime({
      root,
      resourceSampleIntervalMs: 60_000,
      processTreeSampler: async (rootPid) => {
        browserPid = rootPid;
        return {
          sampledAt: new Date().toISOString(),
          rootPid,
          processCount: 1,
          rssBytes: 100,
          cpuTimeMs: 1
        };
      },
      ownedTerminationHook() {
        attempts += 1;
        if (attempts === 1) throw new Error("injected close failure");
      }
    });
    const input = {
      id: "retryable-session",
      purpose: "Retain an owned session until browser termination is verified",
      policy: { allowedOrigins: ["https://example.com"] }
    };
    try {
      const created = await runtime.createSession(input);
      await assert.rejects(
        runtime.closeSession(created.id),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "TERMINATION_UNVERIFIED"
        )
      );
      assert.equal((await runtime.session(created.id)).state, "failed");
      assert.equal(browserPid === undefined ? undefined : processIsRunning(browserPid), true);
      await assert.rejects(
        runtime.act(created.id, { kind: "snapshot", purpose: "Reject work while termination remains unverified" }),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "TERMINATION_UNVERIFIED"
        )
      );
      await assert.rejects(
        runtime.createSession({ ...input, purpose: "Prove the failed owner still holds the session identity" }),
        (error: unknown) => Boolean(
          error && typeof error === "object" && "code" in error && error.code === "SESSION_EXISTS"
        )
      );

      await runtime.closeSession(created.id);
      const replacement = await runtime.createSession({
        ...input,
        purpose: "Reuse the session identity only after verified retry cleanup"
      });
      await runtime.closeSession(replacement.id);
      assert.equal(attempts, 3);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

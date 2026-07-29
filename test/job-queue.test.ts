import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserJob } from "../src/job-queue.js";
import { JobQueue } from "../src/job-queue.js";

test("never retries a browser write with an unknown outcome", async (t) => {
  const path = await queuePath(t);
  let calls = 0;
  const queue = new JobQueue({
    path,
    async execute() {
      calls += 1;
      throw new Error("connection ended after dispatch");
    }
  });
  await queue.initialize();
  const created = await queue.enqueue({
    sessionId: "session-a",
    purpose: "Submit once",
    maxAttempts: 5,
    actions: [{ kind: "click", ref: "submit", purpose: "Submit once" }]
  });

  const completed = await queue.runNext();
  assert.equal(calls, 1);
  assert.equal(completed?.state, "failed");
  assert.equal(completed?.attempts, 1);
  assert.equal(queue.get(created.id).cursor, 0);
});

test("retries only idempotent observation work up to its explicit ceiling", async (t) => {
  const path = await queuePath(t);
  let calls = 0;
  const queue = new JobQueue({
    path,
    async execute() {
      calls += 1;
      if (calls === 1) throw new Error("temporary read failure");
      return { ok: true };
    }
  });
  await queue.initialize();
  await queue.enqueue({
    sessionId: "session-a",
    purpose: "Observe the current page",
    maxAttempts: 2,
    actions: [{ kind: "snapshot", purpose: "Observe the current page" }]
  });

  const completed = await queue.runNext();
  assert.equal(calls, 2);
  assert.equal(completed?.state, "succeeded");
  assert.equal(completed?.cursor, 1);
  assert.equal(completed?.attempts, 0);
});

test("converts an interrupted running job to paused on restart", async (t) => {
  const path = await queuePath(t);
  const persisted: BrowserJob = {
    id: "job-interrupted",
    sessionId: "session-a",
    purpose: "Resume safely",
    actions: [{ kind: "snapshot", purpose: "Resume safely" }],
    cursor: 0,
    attempts: 0,
    maxAttempts: 1,
    state: "running",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
  await writeFile(path, `${JSON.stringify([persisted])}\n`);

  const queue = new JobQueue({ path, execute: async () => ({ ok: true }) });
  await queue.initialize();
  assert.equal(queue.get(persisted.id).state, "paused");

  const completed = await queue.runNext();
  assert.equal(completed?.state, "succeeded");
  assert.equal(JSON.parse(await readFile(path, "utf8"))[0].state, "succeeded");
});

async function queuePath(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-queue-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "queue.json");
}

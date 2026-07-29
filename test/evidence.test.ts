import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActionReceipt } from "../src/contracts.js";
import { EvidenceStore } from "../src/evidence.js";

test("persists content-addressed evidence and detects artifact tampering", async (t) => {
  const root = await temporaryDirectory(t);
  const store = new EvidenceStore({ root, maxBytes: 1024 });
  await store.initialize();

  const record = await store.addBuffer({
    sessionId: "session-a",
    kind: "screenshot",
    contentType: "image/png",
    data: Buffer.from("not-a-real-png"),
    extension: ".png",
    sourceUrl: "https://example.com/"
  });
  assert.match(record.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await store.verify()).ok, true);

  await writeFile(await store.artifactPath(record.id), "tampered");
  const verification = await store.verify();
  assert.equal(verification.ok, false);
  assert.deepEqual(verification.failures, [`${record.id}: digest mismatch`]);
});

test("links action receipts into a deterministic append-only chain", async (t) => {
  const root = await temporaryDirectory(t);
  const store = new EvidenceStore({ root, maxBytes: 1024 });
  await store.initialize();

  const first = await store.appendReceipt(receipt("receipt-a", "input-a", "output-a"));
  const second = await store.appendReceipt(receipt("receipt-b", "input-b", "output-b"));

  assert.equal(first.previousReceiptHash, undefined);
  assert.equal(second.previousReceiptHash, first.receiptHash);
  assert.equal(store.lastReceiptHash, second.receiptHash);
  assert.equal(
    (await readFile(join(root, "receipts", "head.txt"), "utf8").then((value) => value.trim())),
    second.receiptHash
  );

  const reloaded = new EvidenceStore({ root, maxBytes: 1024 });
  await reloaded.initialize();
  assert.equal(reloaded.lastReceiptHash, second.receiptHash);
});

test("enforces the evidence byte ceiling before writing", async (t) => {
  const root = await temporaryDirectory(t);
  const store = new EvidenceStore({ root, maxBytes: 4 });
  await store.initialize();
  await assert.rejects(
    store.addBuffer({
      sessionId: "session-a",
      kind: "action",
      contentType: "text/plain",
      data: Buffer.from("12345")
    }),
    (error: unknown) => hasCode(error, "EVIDENCE_BUDGET_EXCEEDED")
  );
  assert.equal(store.usedBytes, 0);
});

function receipt(
  id: string,
  inputDigest: string,
  outputDigest: string
): Omit<ActionReceipt, "previousReceiptHash" | "receiptHash"> {
  return {
    id,
    sessionId: "session-a",
    action: "snapshot",
    effect: "read",
    risk: "low",
    purpose: "Verify a page",
    inputDigest,
    outputDigest,
    policyDigest: "policy",
    startedAt: "2026-07-29T00:00:00.000Z",
    completedAt: "2026-07-29T00:00:00.001Z",
    durationMs: 1,
    status: "succeeded",
    evidenceIds: []
  };
}

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-evidence-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}

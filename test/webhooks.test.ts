import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserLifecycleEvent } from "../src/contracts.js";
import {
  SignedWebhookDispatcher,
  WebhookReplayGuard,
  signWebhook,
  verifyWebhookSignature
} from "../src/webhooks.js";

const EVENT: BrowserLifecycleEvent = {
  id: "event_release",
  type: "browser.action.completed",
  occurredAt: "2026-07-29T00:00:00.000Z",
  sessionId: "session_release",
  actor: "release-engineer",
  purpose: "Verify signed webhook delivery",
  receiptHash: "sha256:receipt",
  evidenceIds: ["evidence_release"],
  metadata: {
    action: "snapshot",
    status: "succeeded",
    authorization: "must-not-leak"
  }
};

test("persists only explicit HTTPS endpoint configuration and opaque secret references", async (t) => {
  const root = await temporaryDirectory(t);
  const dispatcher = dispatcherFor(root);

  await assert.rejects(
    dispatcher.upsertEndpoint({
      url: "http://example.com/webhook",
      secretRef: "ref:webhook/current",
      keyId: "current"
    }),
    (error: unknown) => hasCode(error, "WEBHOOK_URL_INVALID")
  );
  await assert.rejects(
    dispatcher.upsertEndpoint({
      url: "https://example.com/webhook?token=ambient",
      secretRef: "ref:webhook/current",
      keyId: "current"
    }),
    (error: unknown) => hasCode(error, "WEBHOOK_URL_INVALID")
  );
  await assert.rejects(
    dispatcher.upsertEndpoint({
      url: "https://internal.example/webhook",
      secretRef: "ref:webhook/current",
      keyId: "current"
    }),
    (error: unknown) => hasCode(error, "WEBHOOK_DESTINATION_DENIED")
  );

  const endpoint = await dispatcher.upsertEndpoint({
    id: "release-events",
    url: "https://example.com/browser-events",
    secretRef: "ref:webhook/current",
    keyId: "release-2026",
    events: ["browser.action.completed"],
    maxAttempts: 2
  });
  assert.equal(endpoint.url, "https://example.com/browser-events");
  assert.equal(endpoint.secretRef, "ref:webhook/current");

  const serialized = await readFile(join(root, "config.json"), "utf8");
  assert.match(serialized, /ref:webhook\/current/);
  assert.doesNotMatch(serialized, /super-secret-signing-key/);
});

test("signs deterministic payloads and rejects stale or replayed deliveries", () => {
  const input = {
    secret: "super-secret-signing-key",
    body: "{\"event\":\"release\"}",
    timestamp: "1785283200",
    nonce: "0123456789abcdef0123456789abcdef",
    deliveryId: "delivery_release"
  };
  const signature = `v1=${signWebhook(input)}`;
  const replayGuard = new WebhookReplayGuard();
  const now = new Date("2026-07-29T00:00:00.000Z");

  assert.equal(verifyWebhookSignature({ ...input, signature, now, replayGuard }), true);
  assert.equal(verifyWebhookSignature({ ...input, signature, now, replayGuard }), false);
  assert.equal(
    verifyWebhookSignature({
      ...input,
      signature,
      now: new Date("2026-07-29T01:00:00.000Z")
    }),
    false
  );
  assert.equal(
    verifyWebhookSignature({
      ...input,
      body: "{\"event\":\"tampered\"}",
      signature,
      now
    }),
    false
  );
});

test("retries bounded failures, redacts dead letters, and verifies the delivery chain", async (t) => {
  const root = await temporaryDirectory(t);
  let secretLookups = 0;
  const dispatcher = new SignedWebhookDispatcher({
    root,
    dnsResolver: async (hostname) => (
      hostname === "internal.example"
        ? [{ address: "127.0.0.1" }]
        : [{ address: "8.8.8.8" }]
    ),
    secretResolver: {
      async resolve() {
        secretLookups += 1;
        throw new Error("signing service unavailable");
      }
    },
    sleep: async () => undefined,
    now: () => new Date("2026-07-29T00:00:00.000Z")
  });
  await dispatcher.upsertEndpoint({
    id: "release-events",
    url: "https://example.com/browser-events",
    secretRef: "ref:webhook/current",
    keyId: "release-2026",
    events: ["browser.action.completed"],
    maxAttempts: 3
  });

  await dispatcher.publish(EVENT);
  assert.equal(secretLookups, 3);
  const deadLetters = await readdir(join(root, "dead-letter"));
  assert.equal(deadLetters.length, 1);
  const deadLetter = await readFile(join(root, "dead-letter", deadLetters[0]!), "utf8");
  assert.match(deadLetter, /dead-letter/);
  assert.match(deadLetter, /signing service unavailable/);
  assert.match(deadLetter, /"\[redacted\]"/);
  assert.doesNotMatch(deadLetter, /must-not-leak/);
  assert.doesNotMatch(deadLetter, /ref:webhook\/current/);

  const verification = await dispatcher.verify();
  assert.equal(verification.ok, true);
  assert.equal(verification.receipts, 1);

  const receipts = (await readdir(join(root, "receipts")))
    .filter((name) => name.endsWith(".json"));
  assert.equal(receipts.length, 1);
  const receiptPath = join(root, "receipts", receipts[0]!);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
  receipt.attempts = 99;
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  assert.equal((await dispatcher.verify()).ok, false);
});

function dispatcherFor(root: string): SignedWebhookDispatcher {
  return new SignedWebhookDispatcher({
    root,
    dnsResolver: async (hostname) => (
      hostname === "internal.example"
        ? [{ address: "127.0.0.1" }]
        : [{ address: "8.8.8.8" }]
    ),
    secretResolver: {
      async resolve() {
        return "super-secret-signing-key";
      }
    }
  });
}

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-webhooks-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}

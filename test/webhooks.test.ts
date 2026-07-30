import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

const FIXED_NOW = new Date("2026-07-29T00:00:00.000Z");
const SIGNING_SECRET = "super-secret-signing-key";

const EVENT: BrowserLifecycleEvent = {
  id: "event_release",
  type: "browser.action.completed",
  occurredAt: FIXED_NOW.toISOString(),
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
  assert.doesNotMatch(serialized, new RegExp(SIGNING_SECRET));
});

test("publish only appends to the outbox; DNS and secret resolution begin during drain", async (t) => {
  const root = await temporaryDirectory(t);
  let dnsLookups = 0;
  let secretLookups = 0;
  const dispatcher = new SignedWebhookDispatcher({
    root,
    dnsResolver: async () => {
      dnsLookups += 1;
      return [{ address: "8.8.8.8" }];
    },
    secretResolver: {
      async resolve() {
        secretLookups += 1;
        throw new Error("signing service unavailable");
      }
    },
    now: () => FIXED_NOW
  });
  await dispatcher.upsertEndpoint({
    id: "release-events",
    url: "https://example.com/browser-events",
    secretRef: "ref:webhook/current",
    keyId: "release-2026",
    events: ["browser.action.completed"],
    maxAttempts: 5
  });
  dnsLookups = 0;

  await dispatcher.publish(EVENT);
  assert.equal(dnsLookups, 0);
  assert.equal(secretLookups, 0);
  assert.equal((await dispatcher.health()).queued, 1);

  const result = await dispatcher.drain();
  assert.deepEqual(result, {
    processed: 1,
    delivered: 0,
    deadLetter: 1,
    remaining: 0
  });
  assert.equal(dnsLookups, 1);
  assert.equal(secretLookups, 1, "permanent secret-resolution failures must not be retried");

  const receipt = await readOnlyJsonFile(join(root, "receipts"));
  assert.equal(receipt.status, "dead-letter");
  assert.equal(receipt.attempts, 1);
  assert.deepEqual(receipt.attemptLog, [{
    number: 1,
    outcome: "failed",
    errorCode: "WEBHOOK_SECRET_RESOLUTION_FAILED"
  }]);
  assert.deepEqual(receipt.error, {
    code: "WEBHOOK_SECRET_RESOLUTION_FAILED",
    message: "The configured webhook signing key could not be resolved."
  });
});

test("signatures bind the protocol domain and key id and reject garbage or a full replay guard", () => {
  const input = {
    secret: SIGNING_SECRET,
    body: "{\"event\":\"release\"}",
    timestamp: Math.floor(FIXED_NOW.getTime() / 1_000).toString(),
    nonce: "0123456789abcdef0123456789abcdef",
    deliveryId: "delivery_release",
    keyId: "release-2026"
  };
  const expectedPayload = [
    "cockroach-browser.webhook.v1",
    input.timestamp,
    input.nonce,
    input.deliveryId,
    input.keyId,
    input.body
  ].join("\n");
  const expected = createHmac("sha256", input.secret).update(expectedPayload).digest("hex");
  assert.equal(signWebhook(input), expected);
  assert.notEqual(signWebhook({ ...input, keyId: "release-2027" }), expected);

  const signature = `v1=${expected}`;
  assert.equal(verifyWebhookSignature({ ...input, signature, now: FIXED_NOW }), true);
  assert.equal(
    verifyWebhookSignature({ ...input, signature: `${signature}00`, now: FIXED_NOW }),
    false,
    "a valid signature followed by trailing bytes must be rejected"
  );
  assert.equal(
    verifyWebhookSignature({ ...input, signature: `v1=${"0".repeat(64)}junk`, now: FIXED_NOW }),
    false
  );

  const replayGuard = new WebhookReplayGuard(1);
  assert.equal(verifyWebhookSignature({ ...input, signature, now: FIXED_NOW, replayGuard }), true);
  assert.equal(verifyWebhookSignature({ ...input, signature, now: FIXED_NOW, replayGuard }), false);

  const second = {
    ...input,
    deliveryId: "delivery_second",
    nonce: "fedcba9876543210fedcba9876543210"
  };
  assert.equal(
    verifyWebhookSignature({
      ...second,
      signature: `v1=${signWebhook(second)}`,
      now: FIXED_NOW,
      replayGuard
    }),
    false,
    "a saturated replay guard must fail closed rather than evicting a live nonce"
  );
});

test("rejects translated, private-literal, and mixed DNS webhook destinations", async (t) => {
  const root = await temporaryDirectory(t);
  let literalDnsLookups = 0;
  const dispatcher = new SignedWebhookDispatcher({
    root,
    dnsResolver: async (hostname) => {
      literalDnsLookups += 1;
      if (hostname === "mixed.example") {
        return [{ address: "8.8.8.8" }, { address: "127.0.0.1" }];
      }
      return [{ address: "8.8.8.8" }];
    },
    secretResolver: {
      async resolve() {
        return SIGNING_SECRET;
      }
    }
  });
  const denied = [
    "https://[::ffff:127.0.0.1]/events",
    "https://[::ffff:7f00:1]/events",
    "https://[64:ff9b::7f00:1]/events",
    "https://[2002:7f00:1::]/events",
    "https://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/events",
    "https://[::1]/events",
    "https://[fd00::1]/events",
    "https://mixed.example/events"
  ];

  for (const [index, url] of denied.entries()) {
    await assert.rejects(
      dispatcher.upsertEndpoint({
        id: `denied-${index}`,
        url,
        secretRef: "ref:webhook/current",
        keyId: "release-2026"
      }),
      (error: unknown) => hasCode(error, "WEBHOOK_DESTINATION_DENIED"),
      url
    );
  }

  const beforePublicLiteral = literalDnsLookups;
  const publicLiteral = await dispatcher.upsertEndpoint({
    id: "public-ipv6",
    url: "https://[2606:4700:4700::1111]/events",
    secretRef: "ref:webhook/current",
    keyId: "release-2026"
  });
  assert.equal(publicLiteral.id, "public-ipv6");
  assert.equal(
    literalDnsLookups,
    beforePublicLiteral,
    "literal public IPv6 addresses must be classified directly, not re-resolved"
  );
});

test("enforces the queue ceiling before adding another delivery", async (t) => {
  const root = await temporaryDirectory(t);
  const dispatcher = dispatcherFor(root, { maxQueueItems: 1 });
  await addReleaseEndpoint(dispatcher);

  await dispatcher.publish(EVENT);
  await assert.rejects(
    dispatcher.publish({
      ...EVENT,
      id: "event_second"
    }),
    (error: unknown) => hasCode(error, "WEBHOOK_QUEUE_FULL")
  );
  assert.equal((await dispatcher.health()).queued, 1);
  assert.equal((await readdir(join(root, "queue"))).length, 1);
});

test("recovers a partially committed fanout journal without duplicating deliveries", async (t) => {
  const root = await temporaryDirectory(t);
  const dispatcher = dispatcherFor(root);
  await addReleaseEndpoint(dispatcher);
  await dispatcher.upsertEndpoint({
    id: "audit-events",
    url: "https://audit.example.com/browser-events",
    secretRef: "ref:webhook/audit",
    keyId: "audit-2026",
    events: ["browser.action.completed"],
    maxAttempts: 2
  });

  await dispatcher.publish(EVENT);
  const originalNames = jsonFileNames(await readdir(join(root, "queue")));
  assert.equal(originalNames.length, 2);
  const deliveries = await Promise.all(originalNames.map(async (name) => (
    JSON.parse(await readFile(join(root, "queue", name), "utf8")) as Record<string, unknown>
  )));

  const [interruptedName] = originalNames;
  assert.ok(interruptedName);
  await rm(join(root, "queue", interruptedName));
  const fanout = {
    version: 1,
    eventId: EVENT.id,
    deliveries
  };
  const fanoutPath = join(root, "fanout", "interrupted-fanout.json");
  await writeFile(fanoutPath, serializeJson(fanout));

  const recovered = dispatcherFor(root);
  assert.equal((await recovered.health()).queued, 2);
  assert.deepEqual(
    jsonFileNames(await readdir(join(root, "queue"))),
    originalNames
  );
  assert.deepEqual(jsonFileNames(await readdir(join(root, "fanout"))), []);

  await writeFile(fanoutPath, serializeJson(fanout));
  const idempotentRecovery = dispatcherFor(root);
  assert.equal((await idempotentRecovery.health()).queued, 2);
  assert.deepEqual(jsonFileNames(await readdir(join(root, "fanout"))), []);

  await idempotentRecovery.publish(EVENT);
  assert.deepEqual(
    jsonFileNames(await readdir(join(root, "queue"))),
    originalNames,
    "re-publishing an already recovered event must not create duplicate deliveries"
  );
});

test("an interrupted final attempt consumes its budget and is not repeated", async (t) => {
  const root = await temporaryDirectory(t);
  let dnsLookups = 0;
  let secretLookups = 0;
  const options = {
    root,
    dnsResolver: async () => {
      dnsLookups += 1;
      return [{ address: "8.8.8.8" }];
    },
    secretResolver: {
      async resolve() {
        secretLookups += 1;
        return SIGNING_SECRET;
      }
    },
    now: () => FIXED_NOW
  };
  const dispatcher = new SignedWebhookDispatcher(options);
  await addReleaseEndpoint(dispatcher, 1);
  await dispatcher.publish(EVENT);
  dnsLookups = 0;

  const [queueName] = jsonFileNames(await readdir(join(root, "queue")));
  assert.ok(queueName);
  const queuePath = join(root, "queue", queueName);
  const queued = JSON.parse(await readFile(queuePath, "utf8")) as Record<string, unknown>;
  queued.attempts = 1;
  queued.attemptLog = [{
    number: 1,
    outcome: "started"
  }];
  await writeFile(queuePath, serializeJson(queued));

  const recovered = new SignedWebhookDispatcher(options);
  const result = await recovered.drain();
  assert.deepEqual(result, {
    processed: 1,
    delivered: 0,
    deadLetter: 1,
    remaining: 0
  });
  assert.equal(dnsLookups, 0);
  assert.equal(secretLookups, 0);

  const receipt = await readOnlyJsonFile(join(root, "receipts"));
  assert.equal(receipt.attempts, 1);
  assert.deepEqual(receipt.attemptLog, [{
    number: 1,
    outcome: "failed",
    errorCode: "WEBHOOK_ATTEMPT_INTERRUPTED"
  }]);
  assert.deepEqual(receipt.error, {
    code: "WEBHOOK_ATTEMPT_INTERRUPTED",
    message: "The prior webhook attempt was interrupted before its outcome was committed."
  });
});

test("honors a persisted Retry-After deferral across dispatcher restarts", async (t) => {
  const root = await temporaryDirectory(t);
  let dnsLookups = 0;
  let secretLookups = 0;
  const options = {
    root,
    dnsResolver: async () => {
      dnsLookups += 1;
      return [{ address: "8.8.8.8" }];
    },
    secretResolver: {
      async resolve() {
        secretLookups += 1;
        return SIGNING_SECRET;
      }
    },
    now: () => FIXED_NOW
  };
  const dispatcher = new SignedWebhookDispatcher(options);
  await addReleaseEndpoint(dispatcher);
  await dispatcher.publish(EVENT);
  dnsLookups = 0;

  const [queueName] = jsonFileNames(await readdir(join(root, "queue")));
  assert.ok(queueName);
  const queuePath = join(root, "queue", queueName);
  const queued = JSON.parse(await readFile(queuePath, "utf8")) as Record<string, unknown>;
  const retryAfter = new Date(Date.now() + 60_000).toISOString();
  queued.nextAttemptAt = retryAfter;
  await writeFile(queuePath, serializeJson(queued));

  const recovered = new SignedWebhookDispatcher(options);
  assert.deepEqual(await recovered.drain({ deadlineMs: 1_000 }), {
    processed: 0,
    delivered: 0,
    deadLetter: 0,
    remaining: 1
  });
  assert.equal(dnsLookups, 0);
  assert.equal(secretLookups, 0);
  const deferred = JSON.parse(await readFile(queuePath, "utf8")) as Record<string, unknown>;
  assert.equal(deferred.nextAttemptAt, retryAfter);
  assert.equal(deferred.attempts, 0);
});

test("stores only allowlisted metadata and safely drops cyclic and BigInt values", async (t) => {
  const root = await temporaryDirectory(t);
  const dispatcher = dispatcherFor(root);
  await addReleaseEndpoint(dispatcher);
  const metadata: Record<string, unknown> = {
    action: "snapshot",
    status: "succeeded",
    authorization: "Bearer must-not-leak",
    apiKey: "must-not-leak",
    outputDigest: 2n
  };
  metadata.self = metadata;

  await dispatcher.publish({
    ...EVENT,
    id: "event_redaction",
    actor: "token=must-not-leak",
    purpose: "Deliver Bearer must-not-leak without exposing credentials",
    metadata
  });

  const queued = await readOnlyJsonFile(join(root, "queue"));
  const storedEvent = queued.event as Record<string, unknown>;
  assert.equal(storedEvent.actor, "token=[redacted]");
  assert.equal(
    storedEvent.purpose,
    "Deliver Bearer [redacted] without exposing credentials"
  );
  assert.deepEqual(storedEvent.metadata, {
    action: "snapshot",
    status: "succeeded"
  });
  assert.doesNotMatch(JSON.stringify(storedEvent), /must-not-leak/);
});

test("supports dead-letter retry and purge while detecting receipt tampering", async (t) => {
  const root = await temporaryDirectory(t);
  let secretLookups = 0;
  const dispatcher = new SignedWebhookDispatcher({
    root,
    dnsResolver: async () => [{ address: "8.8.8.8" }],
    secretResolver: {
      async resolve() {
        secretLookups += 1;
        throw new Error("external details must not be persisted");
      }
    },
    now: () => FIXED_NOW
  });
  await addReleaseEndpoint(dispatcher, 4);

  await dispatcher.publish(EVENT);
  await dispatcher.drain();
  assert.equal(secretLookups, 1);
  const [firstDeadLetter] = jsonFileNames(await readdir(join(root, "dead-letter")));
  assert.ok(firstDeadLetter);
  const deadLetterText = await readFile(join(root, "dead-letter", firstDeadLetter), "utf8");
  assert.doesNotMatch(deadLetterText, /external details/);
  assert.doesNotMatch(deadLetterText, /ref:webhook\/current/);
  assert.doesNotMatch(deadLetterText, /must-not-leak/);

  const retryId = await dispatcher.retryDeadLetter(firstDeadLetter.replace(/\.json$/, ""));
  assert.match(retryId, /^delivery_/);
  assert.equal((await dispatcher.health()).deadLetters, 0);
  assert.equal((await dispatcher.health()).queued, 1);

  await dispatcher.drain();
  assert.equal(secretLookups, 2);
  const [secondDeadLetter] = jsonFileNames(await readdir(join(root, "dead-letter")));
  assert.ok(secondDeadLetter);
  await dispatcher.purgeDeadLetter(secondDeadLetter.replace(/\.json$/, ""));
  assert.equal((await dispatcher.health()).deadLetters, 0);

  const verification = await dispatcher.verify();
  assert.equal(verification.ok, true);
  assert.equal(verification.receipts, 2);

  const [receiptName] = jsonFileNames(await readdir(join(root, "receipts")));
  assert.ok(receiptName);
  const receiptPath = join(root, "receipts", receiptName);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
  receipt.attempts = 99;
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  const tampered = await dispatcher.verify();
  assert.equal(tampered.ok, false);
  assert.ok(tampered.failures.some((failure) => failure.includes(receiptName)));
});

test("recovers a dead-letter retry journal exactly once after interruption", async (t) => {
  const root = await temporaryDirectory(t);
  const options = {
    root,
    dnsResolver: async () => [{ address: "8.8.8.8" }],
    secretResolver: {
      async resolve(): Promise<string> {
        throw new Error("signing service unavailable");
      }
    },
    now: () => FIXED_NOW
  };
  const dispatcher = new SignedWebhookDispatcher(options);
  await addReleaseEndpoint(dispatcher, 1);
  await dispatcher.publish(EVENT);
  await dispatcher.drain();

  const [deadLetterName] = jsonFileNames(await readdir(join(root, "dead-letter")));
  assert.ok(deadLetterName);
  const deadLetterId = deadLetterName.replace(/\.json$/, "");
  const deadLetterPath = join(root, "dead-letter", deadLetterName);
  const deadLetter = await readFile(deadLetterPath, "utf8");

  const retryId = await dispatcher.retryDeadLetter(deadLetterId);
  const retryPath = join(root, "queue", `${retryId}.json`);
  const retryQueue = JSON.parse(await readFile(retryPath, "utf8")) as Record<string, unknown>;
  const pendingRetry = {
    version: 1,
    deadLetterId,
    queue: retryQueue
  };
  const pendingPath = join(root, "pending-retry", `${deadLetterId}.json`);

  await writeFile(deadLetterPath, deadLetter);
  await rm(retryPath);
  await writeFile(pendingPath, serializeJson(pendingRetry));

  const recovered = new SignedWebhookDispatcher(options);
  assert.equal((await recovered.health()).queued, 1);
  assert.deepEqual(jsonFileNames(await readdir(join(root, "dead-letter"))), []);
  assert.deepEqual(jsonFileNames(await readdir(join(root, "pending-retry"))), []);
  assert.deepEqual(
    JSON.parse(await readFile(retryPath, "utf8")),
    retryQueue
  );

  await writeFile(pendingPath, serializeJson(pendingRetry));
  const idempotentRecovery = new SignedWebhookDispatcher(options);
  assert.equal((await idempotentRecovery.health()).queued, 1);
  assert.deepEqual(jsonFileNames(await readdir(join(root, "pending-retry"))), []);
  assert.deepEqual(
    JSON.parse(await readFile(retryPath, "utf8")),
    retryQueue
  );
});

test("enforces maxStorageBytes against the full fanout peak without partial queue writes", async (t) => {
  const root = await temporaryDirectory(t);
  const setup = dispatcherFor(root);
  await addReleaseEndpoint(setup);
  const base = await setup.health();
  const maxStorageBytes = 1024 * 1024;
  const reservedBytes = 64;
  const fillerBytes = maxStorageBytes - base.usedBytes - reservedBytes;
  assert.ok(fillerBytes > 0);
  await writeFile(join(root, "storage-filler.bin"), Buffer.alloc(fillerBytes));

  const bounded = new SignedWebhookDispatcher({
    root,
    dnsResolver: async () => [{ address: "8.8.8.8" }],
    secretResolver: {
      async resolve() {
        return SIGNING_SECRET;
      }
    },
    now: () => FIXED_NOW,
    maxStorageBytes
  });
  const before = await bounded.health();
  assert.equal(before.usedBytes, maxStorageBytes - reservedBytes);

  await assert.rejects(
    bounded.publish(EVENT),
    (error: unknown) => hasCode(error, "WEBHOOK_STORAGE_FULL")
  );
  assert.deepEqual(jsonFileNames(await readdir(join(root, "fanout"))), []);
  assert.deepEqual(jsonFileNames(await readdir(join(root, "queue"))), []);
  const after = await bounded.health();
  assert.equal(after.usedBytes, before.usedBytes);
  assert.ok(after.usedBytes <= maxStorageBytes);
});

function dispatcherFor(
  root: string,
  options: { maxQueueItems?: number } = {}
): SignedWebhookDispatcher {
  return new SignedWebhookDispatcher({
    root,
    dnsResolver: async (hostname) => (
      hostname === "internal.example"
        ? [{ address: "127.0.0.1" }]
        : [{ address: "8.8.8.8" }]
    ),
    secretResolver: {
      async resolve() {
        return SIGNING_SECRET;
      }
    },
    now: () => FIXED_NOW,
    ...(options.maxQueueItems !== undefined
      ? { maxQueueItems: options.maxQueueItems }
      : {})
  });
}

async function addReleaseEndpoint(
  dispatcher: SignedWebhookDispatcher,
  maxAttempts = 2
): Promise<void> {
  await dispatcher.upsertEndpoint({
    id: "release-events",
    url: "https://example.com/browser-events",
    secretRef: "ref:webhook/current",
    keyId: "release-2026",
    events: ["browser.action.completed"],
    maxAttempts
  });
}

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-webhooks-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function jsonFileNames(names: string[]): string[] {
  return names.filter((name) => name.endsWith(".json")).sort();
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readOnlyJsonFile(root: string): Promise<Record<string, unknown>> {
  const [name] = jsonFileNames(await readdir(root));
  assert.ok(name, `expected one JSON file in ${root}`);
  return JSON.parse(await readFile(join(root, name), "utf8")) as Record<string, unknown>;
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}

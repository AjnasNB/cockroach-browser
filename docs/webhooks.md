# Signed lifecycle webhooks

Queue locally. Resolve secrets at delivery. Give every terminal outcome a receipt.

Deliver sanitized browser lifecycle events to explicit HTTPS endpoints through a local durable outbox with stable delivery IDs, HMAC-SHA256 signatures, bounded retries, dead letters, and a verifiable receipt chain.

Public manual: https://cockroachbrowser.com/docs/webhooks/

## Configure one endpoint and an opaque key reference

SignedWebhookDispatcher implements BrowserEventPublisher. Attach it to BrowserRuntime to queue session, action, challenge, and evidence events. Endpoint configuration stores only an opaque ref: value. The host-owned resolver returns the actual key during delivery, and the key is never persisted in configuration, queue entries, dead letters, or receipts. Endpoint URLs must use HTTPS and cannot contain credentials, a query string, or a fragment. Configuration resolves the hostname once to reject an invalid destination early; every delivery resolves and validates it again.

```
import {
  BrowserRuntime,
  SignedWebhookDispatcher
} from "cockroach-browser";

const webhookUrl = process.env.COCKROACH_BROWSER_WEBHOOK_URL;
if (!webhookUrl) throw new Error("COCKROACH_BROWSER_WEBHOOK_URL is required");

const webhooks = new SignedWebhookDispatcher({
  root: ".cockroach-browser/webhooks",
  secretResolver: {
    async resolve(reference) {
      const prefix = "ref:env/";
      if (!reference.startsWith(prefix)) {
        throw new Error("Unsupported webhook secret reference");
      }
      const value = process.env[reference.slice(prefix.length)];
      if (!value) throw new Error(`Missing secret for ${reference}`);
      return value;
    }
  },
  maxPayloadBytes: 64 * 1024,
  maxQueueItems: 10_000,
  maxStorageBytes: 256 * 1024 * 1024
});

await webhooks.initialize();
await webhooks.upsertEndpoint({
  id: "release-automation",
  url: webhookUrl,
  secretRef: "ref:env/COCKROACH_BROWSER_WEBHOOK_SECRET",
  keyId: "release-2026-07",
  events: [
    "browser.action.completed",
    "browser.challenge.detected",
    "browser.evidence.recorded"
  ],
  maxAttempts: 3,
  timeoutMs: 5_000
});

const browser = new BrowserRuntime({
  root: ".cockroach-browser/runtime",
  eventPublisher: webhooks
});
await browser.initialize();
```

## Keep publish and drain as separate authorities

publish() validates and sanitizes the event, applies endpoint event filters, enforces the payload and storage ceilings, and atomically appends local queue records. It does not resolve DNS, call the secret resolver, or use the network. drain() is the operator-controlled boundary that revalidates DNS, resolves the referenced key, signs the canonical body, and sends a finite serial batch. Run the drain from a deployment-owned scheduler or worker. An endpoint failure never changes the result of the browser action that produced the lifecycle event.

```
// Publishing is local-only. Draining owns DNS, key resolution, and HTTPS.
const result = await webhooks.drain({
  maxItems: 50,
  deadlineMs: 30_000
});

const health = await webhooks.health();
const integrity = await webhooks.verify();
if (!integrity.ok) {
  throw new Error(integrity.failures.join("\n"));
}

console.log({ result, health, receiptHead: integrity.receiptHead });
```

## Know exactly which events leave the process

Endpoint filters can select browser.session.created, browser.session.closed, browser.action.completed, browser.challenge.detected, browser.challenge.resolved, and browser.evidence.recorded. Event metadata is allowlisted by type. Control characters, credential-bearing URLs, bearer values, tokens, passwords, API keys, cookies, and secret-shaped text are removed or redacted before canonicalization. Payload size is checked after sanitation.

## Verify the signature before parsing or dispatching

Each request includes the event type, stable delivery ID, timestamp, 128-bit nonce, key ID, and v1=<hex> signature. The signature is HMAC-SHA256 over the domain string cockroach-browser.webhook.v1, timestamp, nonce, delivery ID, key ID, and exact body, separated by newlines. verifyWebhookSignature() checks syntax, timestamp tolerance, key binding, and the signature with a timing-safe comparison. The built-in WebhookReplayGuard is a bounded in-process nonce guard and fails closed when full. A multi-process or restart-safe receiver should place the same delivery ID and nonce checks in its durable store.

```
import {
  WebhookReplayGuard,
  verifyWebhookSignature
} from "cockroach-browser";

const replayGuard = new WebhookReplayGuard(10_000);

function required(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function verifyIncomingWebhook(
  body: string,
  headers: Headers,
  secret: string
): { accepted: boolean; deliveryId: string } {
  const deliveryId = required(headers, "x-cockroach-browser-delivery");
  const accepted = verifyWebhookSignature({
    secret,
    body,
    deliveryId,
    timestamp: required(headers, "x-cockroach-browser-timestamp"),
    nonce: required(headers, "x-cockroach-browser-nonce"),
    keyId: required(headers, "x-cockroach-browser-key-id"),
    signature: required(headers, "x-cockroach-browser-signature"),
    replayGuard
  });
  return { accepted, deliveryId };
}
```

## Deduplicate stable delivery IDs

The normal retry path keeps one deterministic delivery ID for an event and endpoint while creating a fresh timestamp and nonce on each request. Verify the request, begin a receiver transaction, return success immediately when that delivery ID was already committed, otherwise apply the event and commit the ID with the result. This makes at-least-once attempts safe at the receiver. A manual retryDeadLetter() intentionally creates a new delivery ID. Keep the original event ID in application-level reconciliation when an operator needs to connect both attempts.

## Retry transient failures and inspect terminal outcomes

HTTP 408, 425, 429, and 5xx responses, plus bounded timeout, DNS, secret-timeout, and transport failures, retry with exponential jitter while attempts and the drain deadline remain. Retry-After is honored up to 30 seconds. Other non-2xx responses become dead letters. Terminal delivered and dead-letter receipts include the attempt log, response status or normalized error, body digest, prior receipt hash, and current receipt hash. Use retryDeadLetter(id) only after fixing the endpoint or key reference. Use purgeDeadLetter(id) for an explicit retention decision, not as an automatic cleanup path.

## Recover interrupted local writes and verify integrity

Initialization recovers interrupted fan-out, dead-letter retry, and terminal receipt transactions from deployment-owned files. An interrupted network attempt is recorded as failed and is retried only when its configured budget remains. Conflicting recovery state fails closed for operator review. verify() recomputes every terminal delivery digest and the single linked receipt chain, detecting altered records, duplicate hashes, forks, cycles, unlinked receipts, and a mismatched persisted head. Initialization refuses to continue when this integrity check fails.

## Keep every queue finite

Defaults are a 64 KiB payload, 10,000 queued deliveries, 256 MiB of webhook storage, three attempts, a five-second endpoint timeout, 25 items per drain, a 60-second drain deadline, and a 4 KiB response ceiling. Configurable limits remain bounded: payloads from 1 KiB to 1 MiB, queues from 1 to 100,000 entries, storage from 1 MiB to 10 GiB, attempts from one to five, endpoint timeouts from 250 ms to 30 seconds, drain batches from one to 1,000, and drain deadlines from one second to ten minutes. health() reports queued records, terminal receipts, dead letters, used bytes, and configured queue and storage ceilings. Diagnostics can observe queued, delivered, dead-letter, capacity, and recovered states but cannot alter delivery.

## Preserve the network and challenge boundary

Every attempt admits only public HTTPS destinations, pins the connection to a validated public address, preserves TLS hostname verification, rejects private, loopback, translated, and mixed public/private DNS results, and never follows redirects. Response bodies are discarded after a 4 KiB ceiling. The dispatcher does not attach browser cookies, profile state, ambient credentials, or URL tokens. A webhook is an outbound integration, not a browser challenge solver. Redirects and access-control responses are rejected or dead-lettered according to the retry rules. The dispatcher does not bypass login, consent, CAPTCHA, rate limits, or endpoint authorization.

## Understand the durability promise

This is a local durable at-least-once outbox for one deployment-owned filesystem. It persists selected events before delivery, recovers interrupted local transactions, retries within finite policy, and records terminal outcomes. It is not a distributed queue, a cross-host consensus system, or an exactly-once transport. Receiver-side deduplication by stable delivery ID is required.


## Release status

This manual targets Cockroach Browser 0.4.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.

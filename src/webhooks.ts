import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import type {
  BrowserEventPublisher,
  BrowserEventType,
  BrowserLifecycleEvent
} from "./contracts.js";
import { BROWSER_EVENT_TYPES } from "./contracts.js";
import { canonicalJson, newId, nowIso, sha256 } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";
import { isPrivateAddress, type DnsResolver } from "./policy.js";

export interface WebhookSecretResolver {
  resolve(reference: string): Promise<string>;
}

export interface WebhookEndpointInput {
  id?: string;
  url: string;
  secretRef: string;
  keyId: string;
  events?: BrowserEventType[];
  enabled?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  secretRef: string;
  keyId: string;
  events: BrowserEventType[];
  enabled: boolean;
  maxAttempts: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryReceipt {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: BrowserEventType;
  bodyDigest: string;
  status: "delivered" | "dead-letter";
  attempts: number;
  attemptLog: Array<{
    number: number;
    outcome: "started" | "delivered" | "retry" | "rejected" | "failed";
    responseStatus?: number;
    errorCode?: string;
  }>;
  createdAt: string;
  completedAt: string;
  responseStatus?: number;
  error?: { code: string; message: string };
  previousDeliveryHash?: string;
  deliveryHash: string;
}

export interface WebhookDispatcherOptions {
  root: string;
  secretResolver: WebhookSecretResolver;
  dnsResolver?: DnsResolver;
  now?: () => Date;
  random?: () => number;
  maxPayloadBytes?: number;
  maxQueueItems?: number;
  maxStorageBytes?: number;
  onDiagnostic?: (diagnostic: WebhookDiagnostic) => void;
}

interface StoredConfig {
  version: 1;
  endpoints: WebhookEndpoint[];
}

interface DeliveryAttempt {
  status: number;
  retryAfterMs?: number;
}

export interface WebhookDiagnostic {
  type:
    | "queued"
    | "delivered"
    | "dead-letter"
    | "queue-full"
    | "storage-full"
    | "recovered";
  occurredAt: string;
  deliveryId?: string;
  endpointId?: string;
  eventId?: string;
  errorCode?: string;
}

export interface QueuedWebhookDelivery {
  version: 1;
  id: string;
  endpoint: WebhookEndpoint;
  event: BrowserLifecycleEvent;
  bodyDigest: string;
  enqueuedAt: string;
  attempts: number;
  attemptLog: WebhookDeliveryReceipt["attemptLog"];
  nextAttemptAt?: string;
}

export interface WebhookDrainResult {
  processed: number;
  delivered: number;
  deadLetter: number;
  remaining: number;
}

interface PendingDelivery {
  version: 1;
  queue: QueuedWebhookDelivery;
  receipt: WebhookDeliveryReceipt;
  deadLetter?: {
    receipt: WebhookDeliveryReceipt;
    event: BrowserLifecycleEvent;
    endpoint: {
      id: string;
      keyId: string;
    };
  };
}

interface PendingFanout {
  version: 1;
  eventId: string;
  deliveries: QueuedWebhookDelivery[];
}

interface PendingDeadLetterRetry {
  version: 1;
  deadLetterId: string;
  queue: QueuedWebhookDelivery;
}

const EVENT_TYPES = new Set<string>(BROWSER_EVENT_TYPES);
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_QUEUE_ITEMS = 10_000;
const DEFAULT_MAX_STORAGE_BYTES = 256 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024;
const SIGNATURE_VERSION = "v1";

export class SignedWebhookDispatcher implements BrowserEventPublisher {
  readonly root: string;
  readonly secretResolver: WebhookSecretResolver;
  readonly dnsResolver: DnsResolver;
  readonly maxPayloadBytes: number;
  readonly maxQueueItems: number;
  readonly maxStorageBytes: number;
  #now: () => Date;
  #random: () => number;
  #onDiagnostic: ((diagnostic: WebhookDiagnostic) => void) | undefined;
  #endpoints = new Map<string, WebhookEndpoint>();
  #initialized = false;
  #initializing: Promise<void> | undefined;
  #lastDeliveryHash: string | undefined;
  #usedBytes = 0;
  #storageTail: Promise<void> = Promise.resolve();
  #deliveryTail: Promise<void> = Promise.resolve();

  constructor(options: WebhookDispatcherOptions) {
    this.root = resolve(options.root);
    this.secretResolver = options.secretResolver;
    this.dnsResolver = options.dnsResolver ?? systemDnsResolver;
    this.maxPayloadBytes = boundedInteger(
      options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
      1_024,
      1024 * 1024,
      "WEBHOOK_PAYLOAD_LIMIT_INVALID"
    );
    this.maxQueueItems = boundedInteger(
      options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS,
      1,
      100_000,
      "WEBHOOK_QUEUE_LIMIT_INVALID"
    );
    this.maxStorageBytes = boundedInteger(
      options.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES,
      1024 * 1024,
      10 * 1024 * 1024 * 1024,
      "WEBHOOK_STORAGE_LIMIT_INVALID"
    );
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.#initializeUnsafe();
    try {
      await this.#initializing;
    } finally {
      this.#initializing = undefined;
    }
  }

  async #initializeUnsafe(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(join(this.root, "queue"), { recursive: true });
    await mkdir(join(this.root, "receipts"), { recursive: true });
    await mkdir(join(this.root, "dead-letter"), { recursive: true });
    await mkdir(join(this.root, "fanout"), { recursive: true });
    await mkdir(join(this.root, "pending"), { recursive: true });
    await mkdir(join(this.root, "pending-retry"), { recursive: true });
    try {
      const config = JSON.parse(await readFile(join(this.root, "config.json"), "utf8")) as unknown;
      if (!isRecord(config) || config.version !== 1 || !Array.isArray(config.endpoints)) {
        throw new CockroachBrowserError("WEBHOOK_CONFIG_INVALID", "The webhook configuration is not version 1.");
      }
      for (const raw of config.endpoints) {
        const endpoint = validateStoredEndpoint(raw);
        this.#endpoints.set(endpoint.id, endpoint);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      this.#lastDeliveryHash = (await readFile(join(this.root, "receipts", "head.txt"), "utf8")).trim() || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#usedBytes = await directoryBytes(this.root);
    await this.#recoverFanout();
    await this.#recoverDeadLetterRetries();
    await this.#recoverPending();
    const integrity = await this.verify();
    if (!integrity.ok) {
      throw new CockroachBrowserError(
        "WEBHOOK_INTEGRITY_FAILED",
        "The webhook delivery ledger failed startup verification.",
        { failures: integrity.failures }
      );
    }
    this.#initialized = true;
  }

  listEndpoints(): WebhookEndpoint[] {
    return [...this.#endpoints.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((endpoint) => structuredClone(endpoint));
  }

  async upsertEndpoint(input: WebhookEndpointInput): Promise<WebhookEndpoint> {
    await this.initialize();
    const id = input.id ?? newId("webhook");
    if (!ENDPOINT_ID.test(id) || id === "." || id === "..") {
      throw new CockroachBrowserError("WEBHOOK_ID_INVALID", "Webhook endpoint IDs must be path-safe identifiers.");
    }
    const url = normalizeEndpointUrl(input.url);
    await withDeadline(
      resolvePublicAddresses(new URL(url).hostname, this.dnsResolver),
      Date.now() + 30_000,
      "WEBHOOK_DNS_TIMEOUT",
      "Webhook endpoint validation exceeded 30 seconds."
    );
    return this.#storageExclusive(async () => {
      const current = this.#endpoints.get(id);
      const timestamp = this.#now().toISOString();
      const endpoint: WebhookEndpoint = {
        id,
        url,
        secretRef: normalizeSecretRef(input.secretRef),
        keyId: normalizeKeyId(input.keyId),
        events: normalizeEvents(input.events),
        enabled: input.enabled ?? current?.enabled ?? true,
        maxAttempts: boundedInteger(
          input.maxAttempts ?? current?.maxAttempts ?? 3,
          1,
          5,
          "WEBHOOK_ATTEMPTS_INVALID"
        ),
        timeoutMs: boundedInteger(
          input.timeoutMs ?? current?.timeoutMs ?? 5_000,
          250,
          30_000,
          "WEBHOOK_TIMEOUT_INVALID"
        ),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      const next = new Map(this.#endpoints);
      next.set(id, endpoint);
      await this.#persistConfig(next);
      this.#endpoints = next;
      return structuredClone(endpoint);
    });
  }

  async disableEndpoint(id: string): Promise<WebhookEndpoint> {
    await this.initialize();
    return this.#storageExclusive(async () => {
      const current = this.#requireEndpoint(id);
      const endpoint: WebhookEndpoint = {
        ...current,
        enabled: false,
        updatedAt: this.#now().toISOString()
      };
      const next = new Map(this.#endpoints);
      next.set(id, endpoint);
      await this.#persistConfig(next);
      this.#endpoints = next;
      return structuredClone(endpoint);
    });
  }

  async rotateEndpointSecret(id: string, secretRef: string, keyId: string): Promise<WebhookEndpoint> {
    await this.initialize();
    return this.#storageExclusive(async () => {
      const current = this.#requireEndpoint(id);
      const endpoint: WebhookEndpoint = {
        ...current,
        secretRef: normalizeSecretRef(secretRef),
        keyId: normalizeKeyId(keyId),
        updatedAt: this.#now().toISOString()
      };
      const next = new Map(this.#endpoints);
      next.set(id, endpoint);
      await this.#persistConfig(next);
      this.#endpoints = next;
      return structuredClone(endpoint);
    });
  }

  async publish(event: BrowserLifecycleEvent): Promise<void> {
    await this.initialize();
    validateEvent(event);
    const sanitized = sanitizeEvent(event);
    const body = canonicalJson(sanitized);
    if (Buffer.byteLength(body) > this.maxPayloadBytes) {
      throw new CockroachBrowserError(
        "WEBHOOK_PAYLOAD_TOO_LARGE",
        `Webhook event ${event.id} exceeds the configured payload ceiling.`
      );
    }
    const endpoints = this.listEndpoints().filter(
      (endpoint) => endpoint.enabled && endpoint.events.includes(event.type)
    );
    await this.#storageExclusive(async () => {
      const queued = await this.#queueFiles();
      const queuedSet = new Set(queued);
      const deliveries: QueuedWebhookDelivery[] = [];
      for (const endpoint of endpoints) {
        const id = deliveryIdFor(event.id, endpoint.id);
        if (queuedSet.has(`${id}.json`)) {
          const existing = validateQueuedDelivery(JSON.parse(await readFile(
            join(this.root, "queue", `${id}.json`),
            "utf8"
          )) as unknown);
          if (
            existing.endpoint.id !== endpoint.id
            || existing.event.id !== event.id
            || existing.bodyDigest !== sha256(body)
          ) {
            throw new CockroachBrowserError(
              "WEBHOOK_QUEUE_EVENT_ID_REUSED",
              "A webhook event id was reused with different delivery content."
            );
          }
          continue;
        }
        const receiptPath = join(this.root, "receipts", `${id}.json`);
        if (await pathExists(receiptPath)) {
          const existing = validateDeliveryReceipt(
            JSON.parse(await readFile(receiptPath, "utf8")) as unknown
          );
          if (
            existing.endpointId !== endpoint.id
            || existing.eventId !== event.id
            || existing.bodyDigest !== sha256(body)
          ) {
            throw new CockroachBrowserError(
              "WEBHOOK_QUEUE_EVENT_ID_REUSED",
              "A terminal webhook event id was reused with different delivery content."
            );
          }
          continue;
        }
        deliveries.push({
          version: 1,
          id,
          endpoint,
          event: sanitized,
          bodyDigest: sha256(body),
          enqueuedAt: this.#now().toISOString(),
          attempts: 0,
          attemptLog: []
        });
      }
      if (queued.length + deliveries.length > this.maxQueueItems) {
        this.#diagnostic({ type: "queue-full", eventId: event.id });
        throw new CockroachBrowserError(
          "WEBHOOK_QUEUE_FULL",
          "The bounded webhook outbox is full; drain it before accepting more lifecycle events."
        );
      }
      if (deliveries.length === 0) return;
      const fanout: PendingFanout = {
        version: 1,
        eventId: event.id,
        deliveries
      };
      const fanoutPath = join(this.root, "fanout", `${fanoutIdFor(event.id)}.json`);
      const requiredBytes = byteLengthJson(fanout)
        + deliveries.reduce((sum, delivery) => sum + byteLengthJson(delivery), 0);
      this.#assertStorageCapacity(requiredBytes);
      await this.#writeExactTrackedJson(
        fanoutPath,
        fanout,
        "WEBHOOK_FANOUT_EVENT_ID_REUSED"
      );
      for (const delivery of deliveries) {
        await this.#writeExactTrackedJson(
          join(this.root, "queue", `${delivery.id}.json`),
          delivery,
          "WEBHOOK_QUEUE_EVENT_ID_REUSED"
        );
        this.#diagnostic({
          type: "queued",
          deliveryId: delivery.id,
          endpointId: delivery.endpoint.id,
          eventId: event.id
        });
      }
      await this.#unlinkTracked(fanoutPath);
    });
  }

  async drain(options: {
    maxItems?: number;
    deadlineMs?: number;
  } = {}): Promise<WebhookDrainResult> {
    await this.initialize();
    const maxItems = boundedInteger(options.maxItems ?? 25, 1, 1_000, "WEBHOOK_DRAIN_LIMIT_INVALID");
    const deadlineMs = boundedInteger(
      options.deadlineMs ?? 60_000,
      1_000,
      10 * 60_000,
      "WEBHOOK_DRAIN_DEADLINE_INVALID"
    );
    return this.#deliveryExclusive(async () => {
      const deadline = Date.now() + deadlineMs;
      const names = (await this.#queueFiles()).slice(0, maxItems);
      let delivered = 0;
      let deadLetter = 0;
      for (const name of names) {
        if (Date.now() >= deadline) break;
        const queuePath = join(this.root, "queue", name);
        const queued = JSON.parse(await readFile(queuePath, "utf8")) as unknown;
        const delivery = validateQueuedDelivery(queued);
        const result = await this.#deliver(delivery, deadline);
        if (result === "delivered") delivered += 1;
        else if (result === "dead-letter") deadLetter += 1;
        else continue;
      }
      const remaining = (await this.#queueFiles()).length;
      return {
        processed: delivered + deadLetter,
        delivered,
        deadLetter,
        remaining
      };
    });
  }

  async health(): Promise<{
    queued: number;
    receipts: number;
    deadLetters: number;
    usedBytes: number;
    maxQueueItems: number;
    maxStorageBytes: number;
  }> {
    await this.initialize();
    return this.#storageExclusive(async () => {
      this.#usedBytes = await directoryBytes(this.root);
      return {
        queued: (await this.#queueFiles()).length,
        receipts: await countJsonFiles(join(this.root, "receipts")),
        deadLetters: await countJsonFiles(join(this.root, "dead-letter")),
        usedBytes: this.#usedBytes,
        maxQueueItems: this.maxQueueItems,
        maxStorageBytes: this.maxStorageBytes
      };
    });
  }

  async retryDeadLetter(id: string): Promise<string> {
    await this.initialize();
    if (!ENDPOINT_ID.test(id)) {
      throw new CockroachBrowserError("WEBHOOK_DELIVERY_ID_INVALID", "Delivery ids must be path-safe.");
    }
    return this.#storageExclusive(async () => {
      const path = join(this.root, "dead-letter", `${id}.json`);
      const deadLetter = validateDeadLetter(
        JSON.parse(await readFile(path, "utf8")) as unknown
      );
      const endpoint = this.#requireEndpoint(deadLetter.endpoint.id);
      if (!endpoint.enabled) {
        throw new CockroachBrowserError("WEBHOOK_ENDPOINT_DISABLED", "Enable the endpoint before retrying.");
      }
      if ((await this.#queueFiles()).length >= this.maxQueueItems) {
        throw new CockroachBrowserError("WEBHOOK_QUEUE_FULL", "The webhook outbox is full.");
      }
      const body = canonicalJson(sanitizeEvent(deadLetter.event));
      const delivery: QueuedWebhookDelivery = {
        version: 1,
        id: newId("delivery"),
        endpoint,
        event: sanitizeEvent(deadLetter.event),
        bodyDigest: sha256(body),
        enqueuedAt: this.#now().toISOString(),
        attempts: 0,
        attemptLog: []
      };
      const pendingRetry: PendingDeadLetterRetry = {
        version: 1,
        deadLetterId: id,
        queue: delivery
      };
      const pendingPath = join(this.root, "pending-retry", `${id}.json`);
      this.#assertStorageCapacity(byteLengthJson(pendingRetry) + byteLengthJson(delivery));
      await this.#writeExactTrackedJson(
        pendingPath,
        pendingRetry,
        "WEBHOOK_DEAD_LETTER_RETRY_CONFLICT"
      );
      await this.#writeExactTrackedJson(
        join(this.root, "queue", `${delivery.id}.json`),
        delivery,
        "WEBHOOK_DEAD_LETTER_RETRY_QUEUE_CONFLICT"
      );
      await this.#unlinkTracked(path);
      await this.#unlinkTracked(pendingPath);
      return delivery.id;
    });
  }

  async purgeDeadLetter(id: string): Promise<void> {
    await this.initialize();
    if (!ENDPOINT_ID.test(id)) {
      throw new CockroachBrowserError("WEBHOOK_DELIVERY_ID_INVALID", "Delivery ids must be path-safe.");
    }
    await this.#storageExclusive(async () => {
      await this.#unlinkTracked(join(this.root, "dead-letter", `${id}.json`));
    });
  }

  async verify(): Promise<{ ok: boolean; receipts: number; receiptHead?: string; failures: string[] }> {
    if (this.#initialized) {
      return this.#storageExclusive(() => this.#verifyUnsafe());
    }
    return this.#verifyUnsafe();
  }

  async #verifyUnsafe(): Promise<{
    ok: boolean;
    receipts: number;
    receiptHead?: string;
    failures: string[];
  }> {
    const failures: string[] = [];
    const receipts = new Map<string, WebhookDeliveryReceipt>();
    try {
      for (const entry of await readdir(join(this.root, "receipts"), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const receipt = validateDeliveryReceipt(JSON.parse(
            await readFile(join(this.root, "receipts", entry.name), "utf8")
          ) as unknown);
          const { deliveryHash, ...unsigned } = receipt;
          if (sha256(unsigned) !== deliveryHash) {
            failures.push(`${entry.name}: delivery digest mismatch`);
            continue;
          }
          if (receipts.has(deliveryHash)) {
            failures.push(`${entry.name}: duplicate delivery hash`);
            continue;
          }
          receipts.set(deliveryHash, receipt);
        } catch (error) {
          failures.push(`${entry.name}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        failures.push(`receipts: ${(error as Error).message}`);
      }
    }
    if (receipts.size > 0) {
      const roots = [...receipts.values()].filter((receipt) => !receipt.previousDeliveryHash);
      if (roots.length !== 1) {
        failures.push(`delivery chain: expected one root, found ${roots.length}`);
      } else {
        const byPrevious = new Map<string, WebhookDeliveryReceipt[]>();
        for (const receipt of receipts.values()) {
          if (!receipt.previousDeliveryHash) continue;
          const children = byPrevious.get(receipt.previousDeliveryHash) ?? [];
          children.push(receipt);
          byPrevious.set(receipt.previousDeliveryHash, children);
        }
        let cursor: WebhookDeliveryReceipt | undefined = roots[0];
        const visited = new Set<string>();
        while (cursor) {
          if (visited.has(cursor.deliveryHash)) {
            failures.push("delivery chain: cycle detected");
            break;
          }
          visited.add(cursor.deliveryHash);
          const children = byPrevious.get(cursor.deliveryHash) ?? [];
          if (children.length > 1) {
            failures.push(`${cursor.id}: delivery chain fork`);
            break;
          }
          cursor = children[0];
        }
        if (visited.size !== receipts.size) {
          failures.push(`delivery chain: ${receipts.size - visited.size} unlinked receipt(s)`);
        }
        const terminal = [...visited].at(-1);
        if (!this.#lastDeliveryHash) {
          failures.push("delivery chain: receipts exist without a persisted head");
        } else if (terminal !== this.#lastDeliveryHash) {
          failures.push("delivery chain: head does not match the verified terminal receipt");
        }
      }
    } else if (this.#lastDeliveryHash) {
      failures.push("delivery chain: head exists without receipts");
    }
    return {
      ok: failures.length === 0,
      receipts: receipts.size,
      ...(this.#lastDeliveryHash ? { receiptHead: this.#lastDeliveryHash } : {}),
      failures
    };
  }

  async #deliver(
    queue: QueuedWebhookDelivery,
    absoluteDeadline: number
  ): Promise<"delivered" | "dead-letter" | "deferred"> {
    const configuredEndpoint = this.#requireEndpoint(queue.endpoint.id);
    if (!configuredEndpoint.enabled) return "deferred";
    const endpoint = structuredClone(configuredEndpoint);
    const event = sanitizeEvent(queue.event);
    const body = canonicalJson(event);
    if (sha256(body) !== queue.bodyDigest) {
      throw new CockroachBrowserError(
        "WEBHOOK_QUEUE_DIGEST_MISMATCH",
        "The queued webhook body no longer matches its recorded digest."
      );
    }

    let current = structuredClone(queue);
    if (
      current.nextAttemptAt !== undefined
      && Date.parse(current.nextAttemptAt) > Date.now()
    ) {
      return "deferred";
    }
    const interrupted = current.attemptLog.at(-1)?.outcome === "started";
    if (interrupted) {
      const recoveredLog = structuredClone(current.attemptLog);
      recoveredLog[recoveredLog.length - 1] = {
        number: current.attempts,
        outcome: "failed",
        errorCode: "WEBHOOK_ATTEMPT_INTERRUPTED"
      };
      current = {
        ...current,
        attemptLog: recoveredLog
      };
      delete current.nextAttemptAt;
      await this.#persistQueued(current);
    }

    let attempts = current.attempts;
    const attemptLog = structuredClone(current.attemptLog);
    const lastCommittedAttempt = attemptLog.at(-1);
    let responseStatus = lastCommittedAttempt?.responseStatus;
    let delivered = lastCommittedAttempt?.outcome === "delivered";
    let terminalOutcome = (
      lastCommittedAttempt?.outcome === "rejected"
      || (
        lastCommittedAttempt?.outcome === "failed"
        && lastCommittedAttempt.errorCode !== "WEBHOOK_ATTEMPT_INTERRUPTED"
      )
      || (
        lastCommittedAttempt?.errorCode === "WEBHOOK_ATTEMPT_INTERRUPTED"
        && attempts >= endpoint.maxAttempts
      )
    );
    let failure: { code: string; message: string } | undefined = terminalOutcome || interrupted
      ? {
          code: lastCommittedAttempt?.errorCode ?? "WEBHOOK_DELIVERY_FAILED",
          message: lastCommittedAttempt?.errorCode === "WEBHOOK_ATTEMPT_INTERRUPTED"
            ? "The prior webhook attempt was interrupted before its outcome was committed."
            : "The webhook delivery reached a previously committed terminal failure."
        }
      : undefined;

    while (!delivered && !terminalOutcome && attempts < endpoint.maxAttempts) {
      if (Date.now() >= absoluteDeadline) {
        await this.#persistQueued({ ...current, attempts, attemptLog });
        return "deferred";
      }
      attempts += 1;
      attemptLog.push({
        number: attempts,
        outcome: "started"
      });
      current = {
        ...current,
        attempts,
        attemptLog: structuredClone(attemptLog)
      };
      delete current.nextAttemptAt;
      await this.#persistQueued(current);
      try {
        const result = await this.#attempt(endpoint, event, body, queue.id, absoluteDeadline);
        responseStatus = result.status;
        if (result.status >= 200 && result.status < 300) {
          attemptLog[attemptLog.length - 1] = {
            number: attempts,
            outcome: "delivered",
            responseStatus: result.status
          };
          current = {
            ...current,
            attempts,
            attemptLog: structuredClone(attemptLog)
          };
          await this.#persistQueued(current);
          failure = undefined;
          delivered = true;
          terminalOutcome = true;
          break;
        }

        const transient = isTransientStatus(result.status);
        failure = {
          code: "WEBHOOK_RESPONSE_REJECTED",
          message: `Webhook endpoint returned HTTP ${result.status}.`
        };
        attemptLog[attemptLog.length - 1] = {
          number: attempts,
          outcome: transient && attempts < endpoint.maxAttempts ? "retry" : "rejected",
          responseStatus: result.status,
          errorCode: failure.code
        };
        current = {
          ...current,
          attempts,
          attemptLog: structuredClone(attemptLog)
        };
        await this.#persistQueued(current);
        if (!transient || attempts >= endpoint.maxAttempts) {
          terminalOutcome = true;
          break;
        }
        await this.#scheduleRetry(current, result.retryAfterMs);
        return "deferred";
      } catch (error) {
        const normalized = normalizeDeliveryError(error);
        const transient = isTransientDeliveryError(normalized.code);
        failure = {
          code: normalized.code,
          message: normalized.message
        };
        attemptLog[attemptLog.length - 1] = {
          number: attempts,
          outcome: transient && attempts < endpoint.maxAttempts ? "retry" : "failed",
          errorCode: failure.code
        };
        current = {
          ...current,
          attempts,
          attemptLog: structuredClone(attemptLog)
        };
        await this.#persistQueued(current);
        if (!transient || attempts >= endpoint.maxAttempts) {
          terminalOutcome = true;
          break;
        }
        await this.#scheduleRetry(current);
        return "deferred";
      }
    }

    const terminalFailure = delivered
      ? undefined
      : failure ?? {
          code: "WEBHOOK_DELIVERY_FAILED",
          message: "Webhook delivery did not reach a successful terminal response."
        };

    await this.#storageExclusive(async () => {
      const unsigned: Omit<WebhookDeliveryReceipt, "deliveryHash"> = {
        id: queue.id,
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: event.type,
        bodyDigest: queue.bodyDigest,
        status: terminalFailure ? "dead-letter" : "delivered",
        attempts,
        attemptLog,
        createdAt: queue.enqueuedAt,
        completedAt: this.#now().toISOString(),
        ...(responseStatus !== undefined ? { responseStatus } : {}),
        ...(terminalFailure ? { error: terminalFailure } : {}),
        ...(this.#lastDeliveryHash ? { previousDeliveryHash: this.#lastDeliveryHash } : {})
      };
      const receipt: WebhookDeliveryReceipt = {
        ...unsigned,
        deliveryHash: sha256(unsigned)
      };
      const pending: PendingDelivery = {
        version: 1,
        queue: { ...current, attempts, attemptLog },
        receipt,
        ...(terminalFailure
          ? {
              deadLetter: {
                receipt,
                event,
                endpoint: {
                  id: endpoint.id,
                  keyId: endpoint.keyId
                }
              }
            }
          : {})
      };
      const pendingPath = join(this.root, "pending", `${receipt.id}.json`);
      const receiptPath = join(this.root, "receipts", `${receipt.id}.json`);
      const deadLetterPath = join(this.root, "dead-letter", `${receipt.id}.json`);
      const requiredBytes = byteLengthJson(pending)
        + await bytesIfMissing(receiptPath, serializeJson(receipt))
        + (pending.deadLetter
          ? await bytesIfMissing(deadLetterPath, serializeJson(pending.deadLetter))
          : 0)
        + Buffer.byteLength(`${receipt.deliveryHash}\n`);
      this.#assertStorageCapacity(requiredBytes);
      await this.#writeTracked(pendingPath, serializeJson(pending));
      await this.#commitPending(pending);
      await this.#unlinkTracked(pendingPath);
    });

    this.#diagnostic({
      type: terminalFailure ? "dead-letter" : "delivered",
      deliveryId: queue.id,
      endpointId: endpoint.id,
      eventId: event.id,
      ...(terminalFailure ? { errorCode: terminalFailure.code } : {})
    });
    return terminalFailure ? "dead-letter" : "delivered";
  }

  async #scheduleRetry(
    queue: QueuedWebhookDelivery,
    retryAfterMs?: number
  ): Promise<void> {
    const jitteredBackoff = Math.round(
      Math.min(250 * (2 ** Math.max(0, queue.attempts - 1)), 5_000)
      * (0.5 + this.#random())
    );
    const delay = Math.max(jitteredBackoff, retryAfterMs ?? 0);
    const nextAttemptAt = new Date(Date.now() + delay).toISOString();
    await this.#persistQueued({
      ...queue,
      nextAttemptAt
    });
  }

  async #attempt(
    endpoint: WebhookEndpoint,
    event: BrowserLifecycleEvent,
    body: string,
    deliveryId: string,
    absoluteDeadline: number
  ): Promise<DeliveryAttempt> {
    const attemptDeadline = Math.min(absoluteDeadline, Date.now() + endpoint.timeoutMs);
    const url = new URL(endpoint.url);
    let addresses: string[];
    try {
      addresses = await withDeadline(
        resolvePublicAddresses(url.hostname, this.dnsResolver),
        attemptDeadline,
        "WEBHOOK_DNS_TIMEOUT",
        "Webhook DNS resolution exceeded the delivery deadline."
      );
    } catch (error) {
      if (error instanceof CockroachBrowserError) throw error;
      throw new CockroachBrowserError(
        "WEBHOOK_DNS_FAILED",
        "Webhook DNS resolution failed."
      );
    }
    const pinnedAddress = addresses[0]!;
    let secret: string;
    try {
      secret = await withDeadline(
        this.secretResolver.resolve(endpoint.secretRef),
        attemptDeadline,
        "WEBHOOK_SECRET_TIMEOUT",
        "Webhook signing-key resolution exceeded the delivery deadline."
      );
    } catch (error) {
      if (
        error instanceof CockroachBrowserError
        && error.code === "WEBHOOK_SECRET_TIMEOUT"
      ) {
        throw error;
      }
      throw new CockroachBrowserError(
        "WEBHOOK_SECRET_RESOLUTION_FAILED",
        "The configured webhook signing key could not be resolved."
      );
    }
    if (!secret || Buffer.byteLength(secret) < 16 || Buffer.byteLength(secret) > 16 * 1024) {
      throw new CockroachBrowserError(
        "WEBHOOK_SECRET_INVALID",
        "Webhook signing secrets must resolve to between 16 bytes and 16 KiB."
      );
    }
    const timestamp = Math.floor(this.#now().getTime() / 1_000).toString();
    const nonce = randomBytes(16).toString("hex");
    const signature = signWebhook({
      secret,
      body,
      timestamp,
      nonce,
      deliveryId,
      keyId: endpoint.keyId
    });
    try {
      return await sendPinnedHttps({
        url,
        address: pinnedAddress,
        body,
        deadline: attemptDeadline,
        headers: {
          "content-type": "application/json",
          "user-agent": "cockroach-browser-webhook/1",
          "x-cockroach-browser-event": event.type,
          "x-cockroach-browser-delivery": deliveryId,
          "x-cockroach-browser-timestamp": timestamp,
          "x-cockroach-browser-nonce": nonce,
          "x-cockroach-browser-key-id": endpoint.keyId,
          "x-cockroach-browser-signature": `${SIGNATURE_VERSION}=${signature}`
        }
      });
    } catch (error) {
      if (error instanceof CockroachBrowserError) throw error;
      throw new CockroachBrowserError(
        "WEBHOOK_TRANSPORT_FAILED",
        "The webhook transport failed before a response was received."
      );
    }
  }

  #requireEndpoint(id: string): WebhookEndpoint {
    const endpoint = this.#endpoints.get(id);
    if (!endpoint) {
      throw new CockroachBrowserError("WEBHOOK_ENDPOINT_NOT_FOUND", `Webhook endpoint ${id} was not found.`);
    }
    return endpoint;
  }

  async #persistConfig(endpoints = this.#endpoints): Promise<void> {
    const config: StoredConfig = {
      version: 1,
      endpoints: [...endpoints.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((endpoint) => structuredClone(endpoint))
    };
    await this.#writeTracked(join(this.root, "config.json"), serializeJson(config));
  }

  async #recoverFanout(): Promise<void> {
    const fanoutRoot = join(this.root, "fanout");
    const names = (await readdir(fanoutRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const path = join(fanoutRoot, name);
      const fanout = validatePendingFanout(
        JSON.parse(await readFile(path, "utf8")) as unknown
      );
      const existingQueue = await this.#queueFiles();
      const missing = fanout.deliveries.filter(
        (delivery) => !existingQueue.includes(`${delivery.id}.json`)
      );
      if (existingQueue.length + missing.length > this.maxQueueItems) {
        throw new CockroachBrowserError(
          "WEBHOOK_QUEUE_FULL",
          "A pending webhook fan-out cannot be recovered within the configured queue ceiling."
        );
      }
      for (const delivery of fanout.deliveries) {
        await this.#writeExactTrackedJson(
          join(this.root, "queue", `${delivery.id}.json`),
          delivery,
          "WEBHOOK_FANOUT_QUEUE_MISMATCH"
        );
      }
      await this.#unlinkTracked(path);
      for (const delivery of fanout.deliveries) {
        this.#diagnostic({
          type: "recovered",
          deliveryId: delivery.id,
          endpointId: delivery.endpoint.id,
          eventId: delivery.event.id
        });
      }
    }
  }

  async #recoverDeadLetterRetries(): Promise<void> {
    const pendingRoot = join(this.root, "pending-retry");
    const names = (await readdir(pendingRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const path = join(pendingRoot, name);
      const pending = validatePendingDeadLetterRetry(
        JSON.parse(await readFile(path, "utf8")) as unknown
      );
      await this.#writeExactTrackedJson(
        join(this.root, "queue", `${pending.queue.id}.json`),
        pending.queue,
        "WEBHOOK_DEAD_LETTER_RETRY_QUEUE_CONFLICT"
      );
      await this.#unlinkTracked(join(
        this.root,
        "dead-letter",
        `${pending.deadLetterId}.json`
      ));
      await this.#unlinkTracked(path);
      this.#diagnostic({
        type: "recovered",
        deliveryId: pending.queue.id,
        endpointId: pending.queue.endpoint.id,
        eventId: pending.queue.event.id
      });
    }
  }

  async #recoverPending(): Promise<void> {
    const pendingRoot = join(this.root, "pending");
    await mkdir(pendingRoot, { recursive: true });
    const names = (await readdir(pendingRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    if (names.length > 1) {
      throw new CockroachBrowserError(
        "WEBHOOK_PENDING_CONFLICT",
        "More than one unfinished webhook transaction requires operator review."
      );
    }
    for (const name of names) {
      const path = join(pendingRoot, name);
      const pending = validatePendingDelivery(JSON.parse(await readFile(path, "utf8")) as unknown);
      await this.#commitPending(pending);
      await this.#unlinkTracked(path);
      this.#diagnostic({
        type: "recovered",
        deliveryId: pending.receipt.id,
        endpointId: pending.receipt.endpointId,
        eventId: pending.receipt.eventId
      });
    }
  }

  async #commitPending(pending: PendingDelivery): Promise<void> {
    const { receipt } = pending;
    if (
      this.#lastDeliveryHash !== receipt.previousDeliveryHash
      && this.#lastDeliveryHash !== receipt.deliveryHash
    ) {
      throw new CockroachBrowserError(
        "WEBHOOK_PENDING_CHAIN_MISMATCH",
        "The pending webhook delivery no longer extends the persisted receipt head."
      );
    }
    await this.#writeExactTrackedJson(
      join(this.root, "receipts", `${receipt.id}.json`),
      receipt,
      "WEBHOOK_PENDING_RECEIPT_MISMATCH"
    );
    if (pending.deadLetter) {
      await this.#writeExactTrackedJson(
        join(this.root, "dead-letter", `${receipt.id}.json`),
        pending.deadLetter,
        "WEBHOOK_PENDING_DEAD_LETTER_MISMATCH"
      );
    }
    if (this.#lastDeliveryHash !== receipt.deliveryHash) {
      await this.#writeTracked(
        join(this.root, "receipts", "head.txt"),
        `${receipt.deliveryHash}\n`
      );
      this.#lastDeliveryHash = receipt.deliveryHash;
    }
    await this.#unlinkTracked(join(this.root, "queue", `${pending.queue.id}.json`));
  }

  async #persistQueued(queue: QueuedWebhookDelivery): Promise<void> {
    await this.#storageExclusive(async () => {
      await this.#writeTracked(
        join(this.root, "queue", `${queue.id}.json`),
        serializeJson(queue)
      );
    });
  }

  async #queueFiles(): Promise<string[]> {
    const root = join(this.root, "queue");
    await mkdir(root, { recursive: true });
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  }

  #assertStorageCapacity(additionalBytes: number): void {
    if (this.#usedBytes + Math.max(0, additionalBytes) > this.maxStorageBytes) {
      this.#diagnostic({ type: "storage-full" });
      throw new CockroachBrowserError(
        "WEBHOOK_STORAGE_FULL",
        "The bounded webhook storage ceiling has been reached."
      );
    }
  }

  async #writeTracked(path: string, content: string): Promise<void> {
    const previousBytes = await fileSize(path);
    const nextBytes = Buffer.byteLength(content);
    this.#assertStorageCapacity(nextBytes);
    await atomicWrite(path, content);
    this.#usedBytes += nextBytes - previousBytes;
  }

  async #writeExactTrackedJson(
    path: string,
    value: unknown,
    mismatchCode: string
  ): Promise<void> {
    const serialized = serializeJson(value);
    try {
      const existing = await readFile(path, "utf8");
      if (existing !== serialized) {
        throw new CockroachBrowserError(
          mismatchCode,
          "An existing webhook record does not match the recovering transaction."
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.#writeTracked(path, serialized);
    }
  }

  async #unlinkTracked(path: string): Promise<void> {
    const previousBytes = await fileSize(path);
    if (previousBytes === 0 && !(await pathExists(path))) return;
    await safeUnlink(path);
    this.#usedBytes = Math.max(0, this.#usedBytes - previousBytes);
  }

  #diagnostic(input: Omit<WebhookDiagnostic, "occurredAt">): void {
    try {
      this.#onDiagnostic?.({
        ...input,
        occurredAt: this.#now().toISOString()
      });
    } catch {
      // Diagnostics are observational and must never alter delivery state.
    }
  }

  async #storageExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const previous = this.#storageTail;
    this.#storageTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #deliveryExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const previous = this.#deliveryTail;
    this.#deliveryTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export interface VerifyWebhookInput {
  secret: string;
  body: string;
  timestamp: string;
  nonce: string;
  deliveryId: string;
  keyId: string;
  signature: string;
  now?: Date;
  toleranceMs?: number;
  replayGuard?: WebhookReplayGuard;
}

export class WebhookReplayGuard {
  #seen = new Map<string, number>();
  readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = boundedInteger(maxEntries, 1, 100_000, "WEBHOOK_REPLAY_LIMIT_INVALID");
  }

  consume(key: string, expiresAt: number, now = Date.now()): boolean {
    for (const [candidate, expiry] of this.#seen) {
      if (expiry <= now) this.#seen.delete(candidate);
    }
    if (this.#seen.has(key) || this.#seen.size >= this.maxEntries) return false;
    this.#seen.set(key, expiresAt);
    return true;
  }
}

export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  const now = input.now ?? new Date();
  const toleranceMs = boundedInteger(
    input.toleranceMs ?? 5 * 60_000,
    1_000,
    30 * 60_000,
    "WEBHOOK_TOLERANCE_INVALID"
  );
  if (!/^\d{10,13}$/.test(input.timestamp) || !/^[a-f0-9]{32}$/i.test(input.nonce)) return false;
  if (
    !ENDPOINT_ID.test(input.deliveryId)
    || !KEY_ID.test(input.keyId)
    || !new RegExp(`^${SIGNATURE_VERSION}=[0-9a-f]{64}$`, "i").test(input.signature)
  ) return false;
  const timestampValue = Number(input.timestamp);
  const milliseconds = input.timestamp.length === 10 ? timestampValue * 1_000 : timestampValue;
  if (!Number.isFinite(milliseconds) || Math.abs(now.getTime() - milliseconds) > toleranceMs) return false;
  const expected = signWebhook(input);
  const supplied = input.signature.slice(SIGNATURE_VERSION.length + 1);
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  if (
    suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)
  ) return false;
  const replayKey = `${input.deliveryId}:${input.nonce}`;
  if (input.replayGuard && !input.replayGuard.consume(replayKey, milliseconds + toleranceMs, now.getTime())) {
    return false;
  }
  return true;
}

export function signWebhook(input: {
  secret: string;
  body: string;
  timestamp: string;
  nonce: string;
  deliveryId: string;
  keyId: string;
}): string {
  const payload = [
    "cockroach-browser.webhook.v1",
    input.timestamp,
    input.nonce,
    input.deliveryId,
    input.keyId,
    input.body
  ].join("\n");
  return createHmac("sha256", input.secret).update(payload).digest("hex");
}

function validateEvent(event: BrowserLifecycleEvent): void {
  if (!ENDPOINT_ID.test(event.id) || !EVENT_TYPES.has(event.type)) {
    throw new CockroachBrowserError("WEBHOOK_EVENT_INVALID", "Webhook events require a valid id and event type.");
  }
  if (!ENDPOINT_ID.test(event.sessionId)) {
    throw new CockroachBrowserError("WEBHOOK_EVENT_INVALID", "Webhook events require a valid session id.");
  }
  if (!event.purpose?.trim() || event.purpose.length > 500 || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new CockroachBrowserError(
      "WEBHOOK_EVENT_INVALID",
      "Webhook events require a concise purpose and ISO timestamp."
    );
  }
}

function sanitizeEvent(event: BrowserLifecycleEvent): BrowserLifecycleEvent {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    sessionId: event.sessionId,
    ...(event.actor ? { actor: sanitizeText(event.actor, 256) } : {}),
    purpose: sanitizeText(event.purpose, 500),
    ...(event.receiptHash ? { receiptHash: event.receiptHash } : {}),
    ...(event.evidenceIds?.length ? { evidenceIds: [...new Set(event.evidenceIds)].slice(0, 256) } : {}),
    ...(event.metadata ? { metadata: sanitizeEventMetadata(event.type, event.metadata) } : {})
  };
}

function sanitizeEventMetadata(
  type: BrowserEventType,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const fields: Partial<Record<BrowserEventType, readonly string[]>> = {
    "browser.session.created": ["policyDigest", "mode", "profile"],
    "browser.session.closed": ["actionsUsed", "evidenceBytes"],
    "browser.action.completed": [
      "action",
      "effect",
      "risk",
      "status",
      "inputDigest",
      "outputDigest",
      "policyDigest",
      "errorCode"
    ],
    "browser.challenge.detected": ["kind", "evidence"],
    "browser.challenge.resolved": ["resolution"],
    "browser.evidence.recorded": [
      "evidenceId",
      "kind",
      "contentType",
      "size",
      "digest"
    ]
  };
  const result: Record<string, unknown> = {};
  for (const key of fields[type] ?? []) {
    const value = metadata[key];
    if (typeof value === "string") {
      result[key] = sanitizeText(value, 1_000);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 64)
        .map((entry) => sanitizeText(entry, 1_000));
    }
  }
  return result;
}

function sanitizeText(input: string, maximum: number): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/\b(token|password|passphrase|secret|api[-_]?key|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, maximum);
}

function normalizeEndpointUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("WEBHOOK_URL_INVALID", "Webhook endpoints require an absolute HTTPS URL.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.search
    || !url.hostname
  ) {
    throw new CockroachBrowserError(
      "WEBHOOK_URL_INVALID",
      "Webhook endpoints require credential-free HTTPS URLs without query strings or fragments."
    );
  }
  return url.toString();
}

function normalizeSecretRef(input: string): string {
  if (!input.startsWith("ref:") || input.length > 512) {
    throw new CockroachBrowserError(
      "WEBHOOK_SECRET_REF_INVALID",
      "Webhook signing keys must be supplied as opaque ref: references."
    );
  }
  return input;
}

function normalizeKeyId(input: string): string {
  if (!KEY_ID.test(input)) {
    throw new CockroachBrowserError("WEBHOOK_KEY_ID_INVALID", "Webhook key ids must be concise identifiers.");
  }
  return input;
}

function normalizeEvents(events: BrowserEventType[] | undefined): BrowserEventType[] {
  const selected = events ?? [...BROWSER_EVENT_TYPES];
  if (selected.length === 0 || selected.some((event) => !EVENT_TYPES.has(event))) {
    throw new CockroachBrowserError("WEBHOOK_EVENTS_INVALID", "Webhook endpoints require valid event selections.");
  }
  return [...new Set(selected)].sort();
}

function validateStoredEndpoint(raw: unknown): WebhookEndpoint {
  if (!isRecord(raw)) {
    throw new CockroachBrowserError("WEBHOOK_CONFIG_INVALID", "A stored webhook endpoint is malformed.");
  }
  const createdAt = Date.parse(readString(raw, "createdAt", "WEBHOOK_CONFIG_INVALID"));
  const updatedAt = Date.parse(readString(raw, "updatedAt", "WEBHOOK_CONFIG_INVALID"));
  const events = raw.events;
  if (
    typeof raw.id !== "string"
    || !ENDPOINT_ID.test(raw.id)
    || !Number.isFinite(createdAt)
    || !Number.isFinite(updatedAt)
    || typeof raw.enabled !== "boolean"
    || !Array.isArray(events)
    || events.length === 0
    || events.some((event) => typeof event !== "string" || !EVENT_TYPES.has(event))
  ) {
    throw new CockroachBrowserError("WEBHOOK_CONFIG_INVALID", "A stored webhook endpoint is malformed.");
  }
  return {
    id: raw.id,
    url: normalizeEndpointUrl(readString(raw, "url", "WEBHOOK_CONFIG_INVALID")),
    secretRef: normalizeSecretRef(readString(raw, "secretRef", "WEBHOOK_CONFIG_INVALID")),
    keyId: normalizeKeyId(readString(raw, "keyId", "WEBHOOK_CONFIG_INVALID")),
    events: normalizeEvents(events as BrowserEventType[]),
    enabled: raw.enabled,
    maxAttempts: boundedInteger(readNumber(raw, "maxAttempts", "WEBHOOK_CONFIG_INVALID"), 1, 5, "WEBHOOK_ATTEMPTS_INVALID"),
    timeoutMs: boundedInteger(readNumber(raw, "timeoutMs", "WEBHOOK_CONFIG_INVALID"), 250, 30_000, "WEBHOOK_TIMEOUT_INVALID"),
    createdAt: readString(raw, "createdAt", "WEBHOOK_CONFIG_INVALID"),
    updatedAt: readString(raw, "updatedAt", "WEBHOOK_CONFIG_INVALID")
  };
}

async function resolvePublicAddresses(hostname: string, resolver: DnsResolver): Promise<string[]> {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const records = isIP(normalizedHostname) !== 0
    ? [{ address: normalizedHostname }]
    : await resolver(normalizedHostname);
  const addresses = [...new Set(records.map((record) => record.address))];
  if (
    addresses.length === 0
    || addresses.length > 16
    || addresses.some((address) => isIP(address) === 0 || isDeniedWebhookAddress(address))
  ) {
    throw new CockroachBrowserError(
      "WEBHOOK_DESTINATION_DENIED",
      "Webhook endpoints must resolve only to public IP addresses."
    );
  }
  return addresses.sort();
}

async function systemDnsResolver(hostname: string): Promise<Array<{ address: string }>> {
  return lookup(hostname, { all: true, verbatim: true });
}

function sendPinnedHttps(input: {
  url: URL;
  address: string;
  body: string;
  deadline: number;
  headers: Record<string, string>;
}): Promise<DeliveryAttempt> {
  return new Promise((resolveRequest, rejectRequest) => {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) {
      rejectRequest(new CockroachBrowserError("WEBHOOK_TIMEOUT", "Webhook delivery timed out."));
      return;
    }
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      operation();
    };
    const targetHostname = input.url.hostname.replace(/^\[|\]$/g, "");
    const requestHandle = request({
      protocol: "https:",
      hostname: targetHostname,
      port: input.url.port ? Number(input.url.port) : 443,
      path: `${input.url.pathname}${input.url.search}`,
      method: "POST",
      ...(isIP(targetHostname) === 0 ? { servername: targetHostname } : {}),
      headers: {
        ...input.headers,
        "content-length": Buffer.byteLength(input.body).toString()
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, input.address, isIP(input.address));
      }
    }, (response) => {
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) requestHandle.destroy(
          new CockroachBrowserError("WEBHOOK_RESPONSE_TOO_LARGE", "Webhook response exceeded 4 KiB.")
        );
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          finish(() => rejectRequest(
            new CockroachBrowserError("WEBHOOK_REDIRECT_DENIED", "Webhook redirects are never followed.")
          ));
          return;
        }
        const retryAfterMs = parseRetryAfter(response.headers["retry-after"]);
        finish(() => resolveRequest({
          status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
        }));
      });
    });
    const deadlineTimer = setTimeout(() => {
      requestHandle.destroy(new CockroachBrowserError("WEBHOOK_TIMEOUT", "Webhook delivery timed out."));
    }, remaining);
    requestHandle.on("error", (error) => finish(() => rejectRequest(error)));
    requestHandle.end(input.body);
  });
}

function boundedInteger(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CockroachBrowserError(code, `Expected an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await safeUnlink(temporary);
    throw error;
  }
}

const TRANSLATED_IPV6 = new BlockList();
TRANSLATED_IPV6.addSubnet("::ffff:0:0", 96, "ipv6");
TRANSLATED_IPV6.addSubnet("64:ff9b::", 96, "ipv6");
TRANSLATED_IPV6.addSubnet("64:ff9b:1::", 48, "ipv6");
TRANSLATED_IPV6.addSubnet("2002::", 16, "ipv6");
TRANSLATED_IPV6.addSubnet("2001::", 32, "ipv6");

function isDeniedWebhookAddress(input: string): boolean {
  const address = input.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6 && TRANSLATED_IPV6.check(address, "ipv6")) return true;
  return isPrivateAddress(address);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isTransientDeliveryError(code: string): boolean {
  return new Set([
    "WEBHOOK_TIMEOUT",
    "WEBHOOK_DNS_TIMEOUT",
    "WEBHOOK_DNS_FAILED",
    "WEBHOOK_SECRET_TIMEOUT",
    "WEBHOOK_TRANSPORT_FAILED"
  ]).has(code);
}

function normalizeDeliveryError(error: unknown): { code: string; message: string } {
  if (error instanceof CockroachBrowserError) {
    return {
      code: error.code,
      message: sanitizeText(error.message, 1_000)
    };
  }
  return {
    code: "WEBHOOK_DELIVERY_FAILED",
    message: "Webhook delivery failed."
  };
}

async function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  code: string,
  message: string
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CockroachBrowserError(code, message);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CockroachBrowserError(code, message)), remaining);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseRetryAfter(input: string | string[] | undefined): number | undefined {
  const value = Array.isArray(input) ? input[0] : input;
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const delay = Math.round(seconds * 1_000);
    return Number.isSafeInteger(delay) && Date.now() + delay <= 8_640_000_000_000_000
      ? delay
      : undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function deliveryIdFor(eventId: string, endpointId: string): string {
  return `delivery_${sha256({ eventId, endpointId }).slice("sha256:".length)}`;
}

function fanoutIdFor(eventId: string): string {
  return `fanout_${sha256({ eventId }).slice("sha256:".length)}`;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function byteLengthJson(value: unknown): number {
  return Buffer.byteLength(serializeJson(value));
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function bytesIfMissing(path: string, content: string): Promise<number> {
  try {
    const existing = await readFile(path, "utf8");
    return existing === content ? 0 : Buffer.byteLength(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Buffer.byteLength(content);
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function countJsonFiles(path: string): Promise<number> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

function validateQueuedDelivery(raw: unknown): QueuedWebhookDelivery {
  if (!isRecord(raw) || raw.version !== 1) {
    throw new CockroachBrowserError("WEBHOOK_QUEUE_INVALID", "A queued webhook delivery is malformed.");
  }
  const id = readString(raw, "id", "WEBHOOK_QUEUE_INVALID");
  const bodyDigest = readString(raw, "bodyDigest", "WEBHOOK_QUEUE_INVALID");
  const enqueuedAt = readString(raw, "enqueuedAt", "WEBHOOK_QUEUE_INVALID");
  const nextAttemptAt = typeof raw.nextAttemptAt === "string"
    ? raw.nextAttemptAt
    : undefined;
  const endpoint = validateStoredEndpoint(raw.endpoint);
  const event = validateStoredEvent(raw.event);
  const attempts = boundedInteger(
    readNumber(raw, "attempts", "WEBHOOK_QUEUE_INVALID"),
    0,
    endpoint.maxAttempts,
    "WEBHOOK_QUEUE_INVALID"
  );
  const attemptLog = validateAttemptLog(raw.attemptLog, endpoint.maxAttempts);
  if (
    !ENDPOINT_ID.test(id)
    || !SHA256_DIGEST.test(bodyDigest)
    || !Number.isFinite(Date.parse(enqueuedAt))
    || (nextAttemptAt !== undefined && !Number.isFinite(Date.parse(nextAttemptAt)))
    || attemptLog.length !== attempts
    || sha256(canonicalJson(event)) !== bodyDigest
  ) {
    throw new CockroachBrowserError("WEBHOOK_QUEUE_INVALID", "A queued webhook delivery is malformed.");
  }
  return {
    version: 1,
    id,
    endpoint,
    event,
    bodyDigest,
    enqueuedAt,
    attempts,
    attemptLog,
    ...(nextAttemptAt !== undefined ? { nextAttemptAt } : {})
  };
}

function validateDeliveryReceipt(raw: unknown): WebhookDeliveryReceipt {
  if (!isRecord(raw)) {
    throw new CockroachBrowserError("WEBHOOK_RECEIPT_INVALID", "A webhook receipt is malformed.");
  }
  const status = raw.status;
  const attempts = readNumber(raw, "attempts", "WEBHOOK_RECEIPT_INVALID");
  const attemptLog = validateAttemptLog(raw.attemptLog, 5);
  const eventType = raw.eventType;
  const receipt: WebhookDeliveryReceipt = {
    id: readString(raw, "id", "WEBHOOK_RECEIPT_INVALID"),
    endpointId: readString(raw, "endpointId", "WEBHOOK_RECEIPT_INVALID"),
    eventId: readString(raw, "eventId", "WEBHOOK_RECEIPT_INVALID"),
    eventType: eventType as BrowserEventType,
    bodyDigest: readString(raw, "bodyDigest", "WEBHOOK_RECEIPT_INVALID"),
    status: status as WebhookDeliveryReceipt["status"],
    attempts,
    attemptLog,
    createdAt: readString(raw, "createdAt", "WEBHOOK_RECEIPT_INVALID"),
    completedAt: readString(raw, "completedAt", "WEBHOOK_RECEIPT_INVALID"),
    ...(typeof raw.responseStatus === "number" ? { responseStatus: raw.responseStatus } : {}),
    ...(isRecord(raw.error) && typeof raw.error.code === "string" && typeof raw.error.message === "string"
      ? { error: { code: raw.error.code, message: raw.error.message } }
      : {}),
    ...(typeof raw.previousDeliveryHash === "string"
      ? { previousDeliveryHash: raw.previousDeliveryHash }
      : {}),
    deliveryHash: readString(raw, "deliveryHash", "WEBHOOK_RECEIPT_INVALID")
  };
  if (
    !ENDPOINT_ID.test(receipt.id)
    || !ENDPOINT_ID.test(receipt.endpointId)
    || !ENDPOINT_ID.test(receipt.eventId)
    || !EVENT_TYPES.has(receipt.eventType)
    || !SHA256_DIGEST.test(receipt.bodyDigest)
    || !["delivered", "dead-letter"].includes(receipt.status)
    || !Number.isSafeInteger(receipt.attempts)
    || receipt.attempts < 1
    || receipt.attempts > 5
    || receipt.attemptLog.length !== receipt.attempts
    || receipt.attemptLog.some((attempt) => attempt.outcome === "started")
    || !Number.isFinite(Date.parse(receipt.createdAt))
    || !Number.isFinite(Date.parse(receipt.completedAt))
    || !SHA256_DIGEST.test(receipt.deliveryHash)
    || (
      receipt.previousDeliveryHash !== undefined
      && !SHA256_DIGEST.test(receipt.previousDeliveryHash)
    )
  ) {
    throw new CockroachBrowserError("WEBHOOK_RECEIPT_INVALID", "A webhook receipt is malformed.");
  }
  return receipt;
}

function validatePendingDelivery(raw: unknown): PendingDelivery {
  if (!isRecord(raw) || raw.version !== 1) {
    throw new CockroachBrowserError("WEBHOOK_PENDING_INVALID", "A pending webhook transaction is malformed.");
  }
  const queue = validateQueuedDelivery(raw.queue);
  const receipt = validateDeliveryReceipt(raw.receipt);
  let deadLetter: PendingDelivery["deadLetter"];
  if (raw.deadLetter !== undefined) {
    if (!isRecord(raw.deadLetter) || !isRecord(raw.deadLetter.endpoint)) {
      throw new CockroachBrowserError("WEBHOOK_PENDING_INVALID", "A pending dead letter is malformed.");
    }
    const deadReceipt = validateDeliveryReceipt(raw.deadLetter.receipt);
    const event = validateStoredEvent(raw.deadLetter.event);
    const endpointId = readString(raw.deadLetter.endpoint, "id", "WEBHOOK_PENDING_INVALID");
    const keyId = readString(raw.deadLetter.endpoint, "keyId", "WEBHOOK_PENDING_INVALID");
    deadLetter = {
      receipt: deadReceipt,
      event,
      endpoint: { id: endpointId, keyId }
    };
  }
  if (
    receipt.id !== queue.id
    || receipt.endpointId !== queue.endpoint.id
    || receipt.eventId !== queue.event.id
    || receipt.bodyDigest !== queue.bodyDigest
    || (
      deadLetter
      && (
        deadLetter.receipt.deliveryHash !== receipt.deliveryHash
        || deadLetter.endpoint.id !== receipt.endpointId
        || !KEY_ID.test(deadLetter.endpoint.keyId)
      )
    )
  ) {
    throw new CockroachBrowserError("WEBHOOK_PENDING_INVALID", "A pending webhook transaction is inconsistent.");
  }
  return {
    version: 1,
    queue,
    receipt,
    ...(deadLetter ? { deadLetter } : {})
  };
}

function validatePendingFanout(raw: unknown): PendingFanout {
  if (
    !isRecord(raw)
    || raw.version !== 1
    || typeof raw.eventId !== "string"
    || !ENDPOINT_ID.test(raw.eventId)
    || !Array.isArray(raw.deliveries)
    || raw.deliveries.length === 0
  ) {
    throw new CockroachBrowserError(
      "WEBHOOK_FANOUT_INVALID",
      "A pending webhook fan-out transaction is malformed."
    );
  }
  const deliveries = raw.deliveries.map(validateQueuedDelivery);
  const ids = new Set<string>();
  for (const delivery of deliveries) {
    if (
      delivery.event.id !== raw.eventId
      || delivery.id !== deliveryIdFor(raw.eventId, delivery.endpoint.id)
      || ids.has(delivery.id)
    ) {
      throw new CockroachBrowserError(
        "WEBHOOK_FANOUT_INVALID",
        "A pending webhook fan-out transaction is inconsistent."
      );
    }
    ids.add(delivery.id);
  }
  return {
    version: 1,
    eventId: raw.eventId,
    deliveries
  };
}

function validatePendingDeadLetterRetry(raw: unknown): PendingDeadLetterRetry {
  if (
    !isRecord(raw)
    || raw.version !== 1
    || typeof raw.deadLetterId !== "string"
    || !ENDPOINT_ID.test(raw.deadLetterId)
  ) {
    throw new CockroachBrowserError(
      "WEBHOOK_DEAD_LETTER_RETRY_INVALID",
      "A pending dead-letter retry transaction is malformed."
    );
  }
  const queue = validateQueuedDelivery(raw.queue);
  if (queue.attempts !== 0 || queue.attemptLog.length !== 0) {
    throw new CockroachBrowserError(
      "WEBHOOK_DEAD_LETTER_RETRY_INVALID",
      "A pending dead-letter retry must begin with a fresh attempt budget."
    );
  }
  return {
    version: 1,
    deadLetterId: raw.deadLetterId,
    queue
  };
}

function validateDeadLetter(raw: unknown): NonNullable<PendingDelivery["deadLetter"]> {
  if (!isRecord(raw) || !isRecord(raw.endpoint)) {
    throw new CockroachBrowserError("WEBHOOK_DEAD_LETTER_INVALID", "The dead-letter record is malformed.");
  }
  const receipt = validateDeliveryReceipt(raw.receipt);
  const event = validateStoredEvent(raw.event);
  const endpoint = {
    id: readString(raw.endpoint, "id", "WEBHOOK_DEAD_LETTER_INVALID"),
    keyId: readString(raw.endpoint, "keyId", "WEBHOOK_DEAD_LETTER_INVALID")
  };
  if (
    receipt.status !== "dead-letter"
    || receipt.eventId !== event.id
    || receipt.endpointId !== endpoint.id
    || !ENDPOINT_ID.test(endpoint.id)
    || !KEY_ID.test(endpoint.keyId)
  ) {
    throw new CockroachBrowserError("WEBHOOK_DEAD_LETTER_INVALID", "The dead-letter record is inconsistent.");
  }
  return { receipt, event, endpoint };
}

function validateStoredEvent(raw: unknown): BrowserLifecycleEvent {
  if (!isRecord(raw)) {
    throw new CockroachBrowserError("WEBHOOK_EVENT_INVALID", "A stored webhook event is malformed.");
  }
  const event: BrowserLifecycleEvent = {
    id: readString(raw, "id", "WEBHOOK_EVENT_INVALID"),
    type: raw.type as BrowserEventType,
    occurredAt: readString(raw, "occurredAt", "WEBHOOK_EVENT_INVALID"),
    sessionId: readString(raw, "sessionId", "WEBHOOK_EVENT_INVALID"),
    ...(typeof raw.actor === "string" ? { actor: raw.actor } : {}),
    purpose: readString(raw, "purpose", "WEBHOOK_EVENT_INVALID"),
    ...(typeof raw.receiptHash === "string" ? { receiptHash: raw.receiptHash } : {}),
    ...(Array.isArray(raw.evidenceIds)
      ? { evidenceIds: raw.evidenceIds.filter((entry): entry is string => typeof entry === "string") }
      : {}),
    ...(isRecord(raw.metadata) ? { metadata: raw.metadata } : {})
  };
  validateEvent(event);
  return sanitizeEvent(event);
}

function validateAttemptLog(
  raw: unknown,
  maximum: number
): WebhookDeliveryReceipt["attemptLog"] {
  if (!Array.isArray(raw) || raw.length > maximum) {
    throw new CockroachBrowserError("WEBHOOK_ATTEMPT_LOG_INVALID", "A webhook attempt log is malformed.");
  }
  return raw.map((entry, index) => {
    if (
      !isRecord(entry)
      || entry.number !== index + 1
      || !["started", "delivered", "retry", "rejected", "failed"].includes(String(entry.outcome))
      || (entry.responseStatus !== undefined && !Number.isSafeInteger(entry.responseStatus))
      || (entry.errorCode !== undefined && typeof entry.errorCode !== "string")
    ) {
      throw new CockroachBrowserError("WEBHOOK_ATTEMPT_LOG_INVALID", "A webhook attempt log is malformed.");
    }
    return {
      number: entry.number,
      outcome: entry.outcome as WebhookDeliveryReceipt["attemptLog"][number]["outcome"],
      ...(typeof entry.responseStatus === "number" ? { responseStatus: entry.responseStatus } : {}),
      ...(typeof entry.errorCode === "string" ? { errorCode: entry.errorCode } : {})
    };
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function readString(
  input: Record<string, unknown>,
  key: string,
  code: string
): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new CockroachBrowserError(code, `Expected ${key} to be a string.`);
  }
  return value;
}

function readNumber(
  input: Record<string, unknown>,
  key: string,
  code: string
): number {
  const value = input[key];
  if (typeof value !== "number") {
    throw new CockroachBrowserError(code, `Expected ${key} to be a number.`);
  }
  return value;
}

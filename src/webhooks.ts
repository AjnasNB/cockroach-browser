import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
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
  sleep?: (milliseconds: number) => Promise<void>;
  maxPayloadBytes?: number;
}

interface StoredConfig {
  version: 1;
  endpoints: WebhookEndpoint[];
}

interface DeliveryAttempt {
  status: number;
}

const EVENT_TYPES = new Set<string>(BROWSER_EVENT_TYPES);
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024;
const SIGNATURE_VERSION = "v1";

export class SignedWebhookDispatcher implements BrowserEventPublisher {
  readonly root: string;
  readonly secretResolver: WebhookSecretResolver;
  readonly dnsResolver: DnsResolver;
  readonly maxPayloadBytes: number;
  #now: () => Date;
  #sleep: (milliseconds: number) => Promise<void>;
  #endpoints = new Map<string, WebhookEndpoint>();
  #initialized = false;
  #lastDeliveryHash: string | undefined;
  #tail: Promise<void> = Promise.resolve();

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
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds);
    }));
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.root, { recursive: true });
    await mkdir(join(this.root, "receipts"), { recursive: true });
    await mkdir(join(this.root, "dead-letter"), { recursive: true });
    try {
      const config = JSON.parse(await readFile(join(this.root, "config.json"), "utf8")) as StoredConfig;
      if (config.version !== 1 || !Array.isArray(config.endpoints)) {
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
    const current = this.#endpoints.get(id);
    const timestamp = this.#now().toISOString();
    const endpoint: WebhookEndpoint = {
      id,
      url: normalizeEndpointUrl(input.url),
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
    await resolvePublicAddresses(new URL(endpoint.url).hostname, this.dnsResolver);
    this.#endpoints.set(id, endpoint);
    await this.#persistConfig();
    return structuredClone(endpoint);
  }

  async disableEndpoint(id: string): Promise<WebhookEndpoint> {
    await this.initialize();
    const current = this.#requireEndpoint(id);
    const endpoint: WebhookEndpoint = {
      ...current,
      enabled: false,
      updatedAt: this.#now().toISOString()
    };
    this.#endpoints.set(id, endpoint);
    await this.#persistConfig();
    return structuredClone(endpoint);
  }

  async rotateEndpointSecret(id: string, secretRef: string, keyId: string): Promise<WebhookEndpoint> {
    await this.initialize();
    const current = this.#requireEndpoint(id);
    const endpoint: WebhookEndpoint = {
      ...current,
      secretRef: normalizeSecretRef(secretRef),
      keyId: normalizeKeyId(keyId),
      updatedAt: this.#now().toISOString()
    };
    this.#endpoints.set(id, endpoint);
    await this.#persistConfig();
    return structuredClone(endpoint);
  }

  async publish(event: BrowserLifecycleEvent): Promise<void> {
    await this.initialize();
    validateEvent(event);
    const body = canonicalJson(redactEvent(event));
    if (Buffer.byteLength(body) > this.maxPayloadBytes) {
      throw new CockroachBrowserError(
        "WEBHOOK_PAYLOAD_TOO_LARGE",
        `Webhook event ${event.id} exceeds the configured payload ceiling.`
      );
    }
    const endpoints = this.listEndpoints().filter(
      (endpoint) => endpoint.enabled && endpoint.events.includes(event.type)
    );
    for (const endpoint of endpoints) {
      await this.#exclusive(async () => this.#deliver(endpoint, event, body));
    }
  }

  async verify(): Promise<{ ok: boolean; receipts: number; receiptHead?: string; failures: string[] }> {
    const failures: string[] = [];
    const receipts = new Map<string, WebhookDeliveryReceipt>();
    try {
      for (const entry of await readdir(join(this.root, "receipts"), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const receipt = JSON.parse(
            await readFile(join(this.root, "receipts", entry.name), "utf8")
          ) as WebhookDeliveryReceipt;
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
    endpoint: WebhookEndpoint,
    event: BrowserLifecycleEvent,
    body: string
  ): Promise<void> {
    const createdAt = this.#now().toISOString();
    const deliveryId = newId("delivery");
    let attempts = 0;
    let responseStatus: number | undefined;
    let failure: { code: string; message: string } | undefined;
    while (attempts < endpoint.maxAttempts) {
      attempts += 1;
      try {
        const result = await this.#attempt(endpoint, event, body, deliveryId);
        responseStatus = result.status;
        if (result.status < 200 || result.status >= 300) {
          throw new CockroachBrowserError(
            "WEBHOOK_RESPONSE_REJECTED",
            `Webhook ${endpoint.id} returned HTTP ${result.status}.`
          );
        }
        failure = undefined;
        break;
      } catch (error) {
        failure = {
          code: error instanceof CockroachBrowserError ? error.code : "WEBHOOK_DELIVERY_FAILED",
          message: (error as Error).message.slice(0, 1_000)
        };
        if (attempts < endpoint.maxAttempts) {
          await this.#sleep(Math.min(250 * (2 ** (attempts - 1)), 2_000));
        }
      }
    }
    const unsigned: Omit<WebhookDeliveryReceipt, "deliveryHash"> = {
      id: deliveryId,
      endpointId: endpoint.id,
      eventId: event.id,
      eventType: event.type,
      bodyDigest: sha256(body),
      status: failure ? "dead-letter" : "delivered",
      attempts,
      createdAt,
      completedAt: this.#now().toISOString(),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      ...(failure ? { error: failure } : {}),
      ...(this.#lastDeliveryHash ? { previousDeliveryHash: this.#lastDeliveryHash } : {})
    };
    const receipt: WebhookDeliveryReceipt = {
      ...unsigned,
      deliveryHash: sha256(unsigned)
    };
    await atomicWrite(
      join(this.root, "receipts", `${receipt.id}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`
    );
    await atomicWrite(join(this.root, "receipts", "head.txt"), `${receipt.deliveryHash}\n`);
    this.#lastDeliveryHash = receipt.deliveryHash;
    if (failure) {
      await atomicWrite(
        join(this.root, "dead-letter", `${receipt.id}.json`),
        `${JSON.stringify({
          receipt,
          event: redactEvent(event),
          endpoint: {
            id: endpoint.id,
            url: endpoint.url,
            keyId: endpoint.keyId
          }
        }, null, 2)}\n`
      );
    }
  }

  async #attempt(
    endpoint: WebhookEndpoint,
    event: BrowserLifecycleEvent,
    body: string,
    deliveryId: string
  ): Promise<DeliveryAttempt> {
    const url = new URL(endpoint.url);
    const addresses = await resolvePublicAddresses(url.hostname, this.dnsResolver);
    const pinnedAddress = addresses[0]!;
    const secret = await this.secretResolver.resolve(endpoint.secretRef);
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
      deliveryId
    });
    return sendPinnedHttps({
      url,
      address: pinnedAddress,
      body,
      timeoutMs: endpoint.timeoutMs,
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
  }

  #requireEndpoint(id: string): WebhookEndpoint {
    const endpoint = this.#endpoints.get(id);
    if (!endpoint) {
      throw new CockroachBrowserError("WEBHOOK_ENDPOINT_NOT_FOUND", `Webhook endpoint ${id} was not found.`);
    }
    return endpoint;
  }

  async #persistConfig(): Promise<void> {
    const config: StoredConfig = {
      version: 1,
      endpoints: this.listEndpoints()
    };
    await atomicWrite(join(this.root, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const previous = this.#tail;
    this.#tail = previous.catch(() => undefined).then(() => gate);
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
    if (this.#seen.has(key)) return false;
    if (this.#seen.size >= this.maxEntries) {
      const oldest = this.#seen.keys().next().value as string | undefined;
      if (oldest) this.#seen.delete(oldest);
    }
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
  if (!ENDPOINT_ID.test(input.deliveryId) || !input.signature.startsWith(`${SIGNATURE_VERSION}=`)) return false;
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
}): string {
  const payload = `${input.timestamp}.${input.nonce}.${input.deliveryId}.${input.body}`;
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

function redactEvent(event: BrowserLifecycleEvent): BrowserLifecycleEvent {
  return redactValue(structuredClone(event), "") as BrowserLifecycleEvent;
}

function redactValue(value: unknown, key: string): unknown {
  if (/(authorization|cookie|password|passphrase|secret|token|credential|storage.?state|headers?|body|valueRef|dataRef)/i.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 256).map((entry) => redactValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 256)
        .map(([childKey, entry]) => [childKey, redactValue(entry, childKey)])
    );
  }
  return value;
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

function validateStoredEndpoint(raw: WebhookEndpoint): WebhookEndpoint {
  const createdAt = Date.parse(raw.createdAt);
  const updatedAt = Date.parse(raw.updatedAt);
  if (
    !ENDPOINT_ID.test(raw.id)
    || !Number.isFinite(createdAt)
    || !Number.isFinite(updatedAt)
    || typeof raw.enabled !== "boolean"
  ) {
    throw new CockroachBrowserError("WEBHOOK_CONFIG_INVALID", "A stored webhook endpoint is malformed.");
  }
  return {
    id: raw.id,
    url: normalizeEndpointUrl(raw.url),
    secretRef: normalizeSecretRef(raw.secretRef),
    keyId: normalizeKeyId(raw.keyId),
    events: normalizeEvents(raw.events),
    enabled: raw.enabled,
    maxAttempts: boundedInteger(raw.maxAttempts, 1, 5, "WEBHOOK_ATTEMPTS_INVALID"),
    timeoutMs: boundedInteger(raw.timeoutMs, 250, 30_000, "WEBHOOK_TIMEOUT_INVALID"),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

async function resolvePublicAddresses(hostname: string, resolver: DnsResolver): Promise<string[]> {
  const records = await resolver(hostname);
  const addresses = [...new Set(records.map((record) => record.address))];
  if (
    addresses.length === 0
    || addresses.length > 16
    || addresses.some((address) => isIP(address) === 0 || isPrivateAddress(address))
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
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<DeliveryAttempt> {
  return new Promise((resolveRequest, rejectRequest) => {
    const requestHandle = request({
      protocol: "https:",
      hostname: input.url.hostname,
      port: input.url.port ? Number(input.url.port) : 443,
      path: `${input.url.pathname}${input.url.search}`,
      method: "POST",
      servername: input.url.hostname,
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
          rejectRequest(
            new CockroachBrowserError("WEBHOOK_REDIRECT_DENIED", "Webhook redirects are never followed.")
          );
          return;
        }
        resolveRequest({ status });
      });
    });
    requestHandle.setTimeout(input.timeoutMs, () => {
      requestHandle.destroy(new CockroachBrowserError("WEBHOOK_TIMEOUT", "Webhook delivery timed out."));
    });
    requestHandle.on("error", rejectRequest);
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
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

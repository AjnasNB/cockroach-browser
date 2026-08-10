import { chromium, firefox, webkit } from "playwright-core";
import type { Browser, BrowserServer, BrowserType, LaunchOptions } from "playwright-core";
import { randomUUID } from "node:crypto";
import type { BrowserEngine } from "./contracts.js";

export type FleetEngine = BrowserEngine | "safari" | "ios-safari" | "android-chrome";
export type FleetProxyKind = "none" | "datacenter" | "residential" | "static" | "custom";
export type FleetChallengeMode = "report" | "provider-authorized";

export interface FleetProviderCapabilities {
  engines: FleetEngine[];
  regions: string[];
  proxyKinds: FleetProxyKind[];
  liveView: boolean;
  challengeModes: FleetChallengeMode[];
  maxSessionTtlMs: number;
}

export interface FleetProxyRequest {
  kind: FleetProxyKind;
  country?: string;
  region?: string;
  staticIpId?: string;
  server?: string;
  username?: string;
  password?: string;
  bypass?: string;
}

export interface FleetSessionRequest {
  engine: FleetEngine;
  purpose: string;
  ttlMs: number;
  region?: string;
  proxy?: FleetProxyRequest;
  challengeMode?: FleetChallengeMode;
  /** Provider-defined compatibility profile; it must not disable access controls. */
  compatibilityProfile?: string;
  metadata?: Record<string, string>;
}

export interface FleetConnection {
  protocol: "playwright" | "cdp" | "bidi" | "webdriver";
  endpoint: string;
  headers?: Record<string, string>;
}

export interface FleetProviderSession {
  providerSessionId: string;
  connection: FleetConnection;
  liveViewUrl?: string;
  expiresAt: string;
  region?: string;
  proxy?: {
    kind: FleetProxyKind;
    country?: string;
    region?: string;
    staticIpId?: string;
  };
}

export interface FleetProviderHealth {
  healthy: boolean;
  capacity?: number;
  active?: number;
  message?: string;
}

export interface BrowserFleetProvider {
  readonly id: string;
  readonly capabilities: FleetProviderCapabilities;
  health(signal?: AbortSignal): Promise<FleetProviderHealth>;
  createSession(request: FleetSessionRequest, signal?: AbortSignal): Promise<FleetProviderSession>;
  closeSession(providerSessionId: string, signal?: AbortSignal): Promise<void>;
}

export interface BrowserFleetOptions {
  providers: BrowserFleetProvider[];
  maxSessions?: number;
  allowedProviders?: string[];
}

export interface BrowserFleetLease extends FleetProviderSession {
  id: string;
  providerId: string;
  engine: FleetEngine;
  purpose: string;
  createdAt: string;
}

/**
 * Provider-neutral session allocator. It does not silently fall back to a
 * different engine, region, proxy class, or challenge policy.
 */
export class BrowserFleet {
  readonly maxSessions: number;
  readonly providers: ReadonlyMap<string, BrowserFleetProvider>;
  readonly allowedProviders: ReadonlySet<string>;
  #leases = new Map<string, BrowserFleetLease>();
  #opening = 0;

  constructor(options: BrowserFleetOptions) {
    this.maxSessions = boundedInteger(options.maxSessions ?? 32, 1, 10_000, "maxSessions");
    const providerMap = new Map<string, BrowserFleetProvider>();
    for (const provider of options.providers) {
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(provider.id)) throw new TypeError(`Invalid fleet provider id ${provider.id}.`);
      if (providerMap.has(provider.id)) throw new TypeError(`Duplicate fleet provider ${provider.id}.`);
      validateCapabilities(provider.capabilities);
      providerMap.set(provider.id, provider);
    }
    if (providerMap.size === 0) throw new TypeError("At least one fleet provider is required.");
    this.providers = providerMap;
    const allowed = options.allowedProviders ?? [...providerMap.keys()];
    for (const id of allowed) if (!providerMap.has(id)) throw new TypeError(`Unknown allowed fleet provider ${id}.`);
    this.allowedProviders = new Set(allowed);
  }

  leases(): BrowserFleetLease[] {
    return [...this.#leases.values()].map((lease) => structuredClone(lease));
  }

  async health(signal?: AbortSignal): Promise<Record<string, FleetProviderHealth>> {
    const result: Record<string, FleetProviderHealth> = {};
    await Promise.all([...this.allowedProviders].map(async (id) => {
      result[id] = await this.providers.get(id)!.health(signal);
    }));
    return result;
  }

  async createSession(request: FleetSessionRequest, options: { providerId?: string; signal?: AbortSignal } = {}): Promise<BrowserFleetLease> {
    validateRequest(request);
    await this.#reapExpired(options.signal);
    if (this.#leases.size + this.#opening >= this.maxSessions) throw new Error("The browser fleet session ceiling has been reached.");
    const candidates = [...this.allowedProviders]
      .filter((id) => !options.providerId || id === options.providerId)
      .map((id) => this.providers.get(id)!)
      .filter((provider) => supports(provider.capabilities, request));
    if (candidates.length === 0) {
      throw new Error("No allowed fleet provider exactly supports the requested engine, region, proxy, challenge mode, and TTL.");
    }
    let selected: BrowserFleetProvider | undefined;
    for (const provider of candidates) {
      const health = await provider.health(options.signal);
      if (health.healthy && (health.capacity === undefined || (health.active ?? 0) < health.capacity)) {
        selected = provider;
        break;
      }
    }
    if (!selected) throw new Error("Every compatible fleet provider is unhealthy or at capacity.");
    this.#opening += 1;
    try {
      const providerSession = await selected.createSession(structuredClone(request), options.signal);
      try {
        validateProviderSession(providerSession, request.ttlMs);
      } catch (validationError) {
        if (typeof providerSession?.providerSessionId === "string" && providerSession.providerSessionId.length <= 512) {
          try {
            await selected.closeSession(providerSession.providerSessionId, options.signal);
          } catch (cleanupError) {
            throw new AggregateError([validationError, cleanupError], "The fleet provider returned an invalid session and cleanup was not confirmed.");
          }
        }
        throw validationError;
      }
      const createdAt = new Date().toISOString();
      const lease: BrowserFleetLease = {
        ...structuredClone(providerSession),
        id: `fleet_${randomUUID()}`,
        providerId: selected.id,
        engine: request.engine,
        purpose: request.purpose,
        createdAt
      };
      this.#leases.set(lease.id, lease);
      return structuredClone(lease);
    } finally {
      this.#opening -= 1;
    }
  }

  async connect(leaseId: string): Promise<Browser> {
    const lease = this.#leases.get(leaseId);
    if (!lease) throw new Error(`Unknown fleet lease ${leaseId}.`);
    if (new Date(lease.expiresAt).getTime() <= Date.now()) {
      await this.closeSession(leaseId);
      throw new Error(`Fleet lease ${leaseId} expired.`);
    }
    if (lease.connection.protocol === "playwright") {
      if (lease.engine !== "chromium" && lease.engine !== "firefox" && lease.engine !== "webkit") {
        throw new Error(`Playwright cannot connect the declared ${lease.engine} engine.`);
      }
      return browserType(lease.engine).connect(lease.connection.endpoint, {
        ...(lease.connection.headers ? { headers: lease.connection.headers } : {})
      });
    }
    if (lease.connection.protocol === "cdp" && lease.engine === "chromium") {
      return chromium.connectOverCDP(lease.connection.endpoint, {
        ...(lease.connection.headers ? { headers: lease.connection.headers } : {})
      });
    }
    throw new Error(`Use the public BiDi or mobile module for ${lease.connection.protocol} fleet connections.`);
  }

  async closeSession(leaseId: string, signal?: AbortSignal): Promise<void> {
    const lease = this.#leases.get(leaseId);
    if (!lease) return;
    const provider = this.providers.get(lease.providerId)!;
    await provider.closeSession(lease.providerSessionId, signal);
    this.#leases.delete(leaseId);
  }

  async close(signal?: AbortSignal): Promise<void> {
    const errors: unknown[] = [];
    for (const id of [...this.#leases.keys()]) {
      try {
        await this.closeSession(id, signal);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "One or more fleet sessions could not be closed.");
  }

  async #reapExpired(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    for (const lease of [...this.#leases.values()]) {
      if (new Date(lease.expiresAt).getTime() <= now) await this.closeSession(lease.id, signal);
    }
  }
}

export interface LocalBrowserFleetProviderOptions {
  id?: string;
  maxSessions?: number;
  launchOptions?: LaunchOptions;
}

export interface HttpBrowserFleetProviderOptions {
  id: string;
  endpoint: string;
  capabilities: FleetProviderCapabilities;
  token?: string;
  tokenProvider?: () => string | Promise<string>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * Concrete REST adapter for operator-selected managed or self-hosted fleets.
 * The provider must implement GET /v1/health, POST /v1/sessions, and
 * DELETE /v1/sessions/{id}. Secrets stay in the trusted host process.
 */
export class HttpBrowserFleetProvider implements BrowserFleetProvider {
  readonly id: string;
  readonly endpoint: URL;
  readonly capabilities: FleetProviderCapabilities;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  #token: string | undefined;
  #tokenProvider: (() => string | Promise<string>) | undefined;

  constructor(options: HttpBrowserFleetProviderOptions) {
    this.id = options.id;
    this.endpoint = ensureTrailingSlash(new URL(options.endpoint));
    if (this.endpoint.protocol !== "https:" && !isLoopback(this.endpoint.hostname)) {
      throw new TypeError("Remote browser fleet endpoints must use HTTPS.");
    }
    validateCapabilities(options.capabilities);
    this.capabilities = structuredClone(options.capabilities);
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 60_000, 100, 600_000, "timeoutMs");
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 8 * 1024 * 1024, 1_024, 64 * 1024 * 1024, "maxResponseBytes");
    this.#token = options.token;
    this.#tokenProvider = options.tokenProvider;
  }

  async health(signal?: AbortSignal): Promise<FleetProviderHealth> {
    return this.#request("GET", "v1/health", undefined, signal);
  }

  async createSession(request: FleetSessionRequest, signal?: AbortSignal): Promise<FleetProviderSession> {
    validateRequest(request);
    const session = await this.#request<unknown>("POST", "v1/sessions", request, signal);
    if (!isRecord(session)) throw new Error("The fleet provider returned a malformed session.");
    return session as unknown as FleetProviderSession;
  }

  async closeSession(providerSessionId: string, signal?: AbortSignal): Promise<void> {
    if (!providerSessionId || providerSessionId.length > 512) throw new TypeError("A bounded provider session id is required.");
    await this.#request("DELETE", `v1/sessions/${encodeURIComponent(providerSessionId)}`, undefined, signal);
  }

  async #request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const token = this.#token ?? await this.#tokenProvider?.();
      const response = await fetch(new URL(path, this.endpoint), {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...this.headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const bytes = await readBoundedResponse(response, this.maxResponseBytes, "The fleet provider response exceeded maxResponseBytes.");
      const decoded = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) as unknown : undefined;
      if (!response.ok) throw new Error(`The fleet provider returned HTTP ${response.status}.`);
      return decoded as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

/** Working local process fleet for Chromium, Firefox, and WebKit. */
export class LocalBrowserFleetProvider implements BrowserFleetProvider {
  readonly id: string;
  readonly capabilities: FleetProviderCapabilities;
  readonly maxSessions: number;
  readonly launchOptions: LaunchOptions;
  #servers = new Map<string, BrowserServer>();

  constructor(options: LocalBrowserFleetProviderOptions = {}) {
    this.id = options.id ?? "local-playwright";
    this.maxSessions = boundedInteger(options.maxSessions ?? 8, 1, 256, "maxSessions");
    this.launchOptions = { headless: true, ...(options.launchOptions ?? {}) };
    this.capabilities = {
      engines: ["chromium", "firefox", "webkit"],
      regions: ["local"],
      proxyKinds: ["none", "custom"],
      liveView: false,
      challengeModes: ["report"],
      maxSessionTtlMs: 24 * 60 * 60_000
    };
  }

  async health(): Promise<FleetProviderHealth> {
    return { healthy: true, capacity: this.maxSessions, active: this.#servers.size };
  }

  async createSession(request: FleetSessionRequest): Promise<FleetProviderSession> {
    validateRequest(request);
    if (request.engine !== "chromium" && request.engine !== "firefox" && request.engine !== "webkit") {
      throw new Error(`The local provider does not support ${request.engine}.`);
    }
    if (this.#servers.size >= this.maxSessions) throw new Error("The local browser provider is at capacity.");
    if ((request.proxy?.kind ?? "none") !== "none" && request.proxy?.kind !== "custom") {
      throw new Error("The local provider accepts only direct or explicit custom proxy connections.");
    }
    if (request.challengeMode && request.challengeMode !== "report") {
      throw new Error("The local provider reports challenges but does not solve them.");
    }
    const proxy = request.proxy?.kind === "custom"
      ? {
          server: requiredString(request.proxy.server, "proxy.server"),
          ...(request.proxy.username ? { username: request.proxy.username } : {}),
          ...(request.proxy.password ? { password: request.proxy.password } : {}),
          ...(request.proxy.bypass ? { bypass: request.proxy.bypass } : {})
        }
      : undefined;
    const server = await browserType(request.engine).launchServer({
      ...this.launchOptions,
      ...(proxy ? { proxy } : {})
    });
    const providerSessionId = randomUUID();
    this.#servers.set(providerSessionId, server);
    return {
      providerSessionId,
      connection: { protocol: "playwright", endpoint: server.wsEndpoint() },
      expiresAt: new Date(Date.now() + request.ttlMs).toISOString(),
      region: "local",
      proxy: { kind: request.proxy?.kind ?? "none" }
    };
  }

  async closeSession(providerSessionId: string): Promise<void> {
    const server = this.#servers.get(providerSessionId);
    if (!server) return;
    await server.close();
    this.#servers.delete(providerSessionId);
  }
}

function browserType(engine: BrowserEngine): BrowserType {
  if (engine === "firefox") return firefox;
  if (engine === "webkit") return webkit;
  return chromium;
}

function supports(capabilities: FleetProviderCapabilities, request: FleetSessionRequest): boolean {
  const proxy = request.proxy?.kind ?? "none";
  const challenge = request.challengeMode ?? "report";
  return capabilities.engines.includes(request.engine)
    && (!request.region || capabilities.regions.includes(request.region))
    && capabilities.proxyKinds.includes(proxy)
    && capabilities.challengeModes.includes(challenge)
    && request.ttlMs <= capabilities.maxSessionTtlMs;
}

function validateCapabilities(capabilities: FleetProviderCapabilities): void {
  if (capabilities.engines.length === 0) throw new TypeError("Fleet providers must declare at least one engine.");
  if (capabilities.regions.length === 0) throw new TypeError("Fleet providers must declare at least one region.");
  if (capabilities.proxyKinds.length === 0) throw new TypeError("Fleet providers must declare at least one proxy kind.");
  if (capabilities.challengeModes.length === 0) throw new TypeError("Fleet providers must declare a challenge policy.");
  boundedInteger(capabilities.maxSessionTtlMs, 1_000, 7 * 24 * 60 * 60_000, "maxSessionTtlMs");
}

function validateRequest(request: FleetSessionRequest): void {
  if (!request.purpose?.trim() || request.purpose.length > 1_000) throw new TypeError("Fleet sessions require a bounded purpose.");
  boundedInteger(request.ttlMs, 1_000, 7 * 24 * 60 * 60_000, "ttlMs");
  if (request.metadata && Object.keys(request.metadata).length > 64) throw new RangeError("Fleet session metadata is limited to 64 entries.");
}

function validateProviderSession(session: FleetProviderSession, requestedTtlMs: number): void {
  if (!session.providerSessionId || session.providerSessionId.length > 512) throw new Error("The fleet provider returned an invalid session id.");
  const endpoint = new URL(session.connection.endpoint);
  const protocols: Record<FleetConnection["protocol"], string[]> = {
    playwright: ["ws:", "wss:"],
    cdp: ["http:", "https:", "ws:", "wss:"],
    bidi: ["ws:", "wss:"],
    webdriver: ["http:", "https:"]
  };
  if (!protocols[session.connection.protocol].includes(endpoint.protocol)) throw new Error("The fleet provider returned an invalid connection endpoint.");
  const expiry = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + requestedTtlMs + 60_000) {
    throw new Error("The fleet provider returned an invalid session expiry.");
  }
  if (session.liveViewUrl) {
    const live = new URL(session.liveViewUrl);
    if (live.protocol !== "https:") throw new Error("Live-session viewer URLs must use HTTPS.");
  }
}

function requiredString(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new TypeError(`${label} is required.`);
  return value;
}

function ensureTrailingSlash(value: URL): URL {
  const copy = new URL(value);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value.endsWith(".localhost") || value === "127.0.0.1" || value === "::1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedResponse(response: Response, maximum: number, message: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel(message);
        throw new RangeError(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

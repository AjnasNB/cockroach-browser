export interface BidiCommandResult<T> {
  id: number;
  type: "success";
  result: T;
}

export interface BidiEvent<T = unknown> {
  type: "event";
  method: string;
  params: T;
}

export interface BidiSessionOptions {
  commandTimeoutMs?: number;
  maxMessageBytes?: number;
  protocols?: string | string[];
}

type BidiListener = (event: BidiEvent) => void;

interface PendingCommand {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Raw WebDriver BiDi JSON-RPC session for operator-owned endpoints. */
export class BidiSession {
  readonly url: string;
  readonly socket: WebSocket;
  readonly commandTimeoutMs: number;
  readonly maxMessageBytes: number;
  #nextId = 1;
  #closed = false;
  #pending = new Map<number, PendingCommand>();
  #listeners = new Map<string, Set<BidiListener>>();

  private constructor(url: string, socket: WebSocket, options: BidiSessionOptions) {
    this.url = url;
    this.socket = socket;
    this.commandTimeoutMs = bounded(options.commandTimeoutMs ?? 30_000, 100, 300_000, "commandTimeoutMs");
    this.maxMessageBytes = bounded(options.maxMessageBytes ?? 8 * 1024 * 1024, 1_024, 64 * 1024 * 1024, "maxMessageBytes");
    socket.addEventListener("message", (event) => this.#receive(event.data));
    socket.addEventListener("close", () => this.#closePending(new Error("The WebDriver BiDi connection closed.")));
    socket.addEventListener("error", () => this.#closePending(new Error("The WebDriver BiDi connection failed.")));
  }

  static async connect(url: string, options: BidiSessionOptions = {}): Promise<BidiSession> {
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) {
      throw new TypeError("WebDriver BiDi endpoints must use ws: or wss:.");
    }
    const socket = new WebSocket(parsed, options.protocols);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to the WebDriver BiDi endpoint.")), 30_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the WebDriver BiDi endpoint."));
      }, { once: true });
    });
    return new BidiSession(parsed.toString(), socket, options);
  }

  get closed(): boolean {
    return this.#closed;
  }

  async command<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.#closed || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("The WebDriver BiDi session is not open.");
    }
    if (!method || method.length > 256) throw new TypeError("A bounded BiDi method name is required.");
    const id = this.#nextId++;
    const body = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(body) > this.maxMessageBytes) {
      throw new RangeError("The WebDriver BiDi command exceeds maxMessageBytes.");
    }
    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`WebDriver BiDi command ${method} timed out.`));
      }, this.commandTimeoutMs);
      this.#pending.set(id, {
        method,
        timeout,
        resolve: (value) => resolve(value as T),
        reject
      });
    });
    this.socket.send(body);
    return result;
  }

  async subscribe(events: string[], contexts?: string[]): Promise<unknown> {
    return this.command("session.subscribe", {
      events: boundedStrings(events, "events"),
      ...(contexts ? { contexts: boundedStrings(contexts, "contexts") } : {})
    });
  }

  on(method: string, listener: BidiListener): () => void {
    const listeners = this.#listeners.get(method) ?? new Set<BidiListener>();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(method);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#closePending(new Error("The WebDriver BiDi session was closed."));
    this.socket.close(1000, "client close");
  }

  #receive(raw: unknown): void {
    const text = typeof raw === "string" ? raw : raw instanceof Blob ? undefined : String(raw);
    if (text === undefined || Buffer.byteLength(text) > this.maxMessageBytes) {
      void this.close();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.id === "number") {
      const pending = this.#pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(value.id);
      if (value.type === "success") pending.resolve(value.result);
      else pending.reject(new Error(bidiError(value, pending.method)));
      return;
    }
    if (value.type !== "event" || typeof value.method !== "string") return;
    const event: BidiEvent = { type: "event", method: value.method, params: value.params };
    for (const listener of this.#listeners.get(value.method) ?? []) listener(event);
    for (const listener of this.#listeners.get("*") ?? []) listener(event);
  }

  #closePending(error: Error): void {
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bidiError(value: Record<string, unknown>, method: string): string {
  const code = typeof value.error === "string" ? value.error : "unknown error";
  const message = typeof value.message === "string" ? value.message : "The command failed.";
  return `WebDriver BiDi command ${method} failed (${code}): ${message}`;
}

function bounded(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedStrings(values: string[], label: string): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 256) {
    throw new RangeError(`${label} must contain between 1 and 256 entries.`);
  }
  return values.map((value) => {
    if (typeof value !== "string" || !value || value.length > 512) {
      throw new TypeError(`${label} entries must be non-empty strings no longer than 512 characters.`);
    }
    return value;
  });
}

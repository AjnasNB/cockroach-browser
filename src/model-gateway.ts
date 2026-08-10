export type ModelRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: string;
  toolCalls: ModelToolCall[];
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ModelGateway {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface OpenAICompatibleGatewayOptions {
  endpoint?: string;
  model: string;
  apiKey?: string;
  apiKeyProvider?: () => string | Promise<string>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** OpenAI-compatible chat-completions gateway with bounded transport. */
export class OpenAICompatibleModelGateway implements ModelGateway {
  readonly endpoint: URL;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly headers: Readonly<Record<string, string>>;
  #apiKey: string | undefined;
  #apiKeyProvider: (() => string | Promise<string>) | undefined;

  constructor(options: OpenAICompatibleGatewayOptions) {
    this.endpoint = new URL("chat/completions", ensureTrailingSlash(new URL(options.endpoint ?? "https://api.openai.com/v1/")));
    if (this.endpoint.protocol !== "https:" && !isLoopback(this.endpoint.hostname)) {
      throw new TypeError("Remote model gateway endpoints must use HTTPS.");
    }
    if (!options.model || options.model.length > 256) throw new TypeError("A bounded model identifier is required.");
    if (!options.apiKey && !options.apiKeyProvider) throw new TypeError("An API key or API-key provider is required.");
    this.model = options.model;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 120_000, 1_000, 600_000, "timeoutMs");
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 8 * 1024 * 1024, 1_024, 64 * 1024 * 1024, "maxResponseBytes");
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
    this.#apiKey = options.apiKey;
    this.#apiKeyProvider = options.apiKeyProvider;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 512) {
      throw new RangeError("Model requests require between 1 and 512 messages.");
    }
    const key = this.#apiKey ?? await this.#apiKeyProvider?.();
    if (!key) throw new Error("The model API-key provider returned no key.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      const body = {
        model: this.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.name ? { name: message.name } : {}),
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {})
        })),
        ...(request.tools?.length ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema
            }
          })),
          tool_choice: "auto"
        } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens })
      };
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          ...this.headers
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const bytes = await readBoundedResponse(response, this.maxResponseBytes, "The model response exceeded maxResponseBytes.");
      const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!response.ok) throw new Error(`The model gateway returned HTTP ${response.status}.`);
      return parseOpenAIResponse(decoded);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

function parseOpenAIResponse(value: unknown): ModelResponse {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new Error("The model gateway returned a malformed response.");
  }
  const choice = value.choices[0];
  if (!isRecord(choice.message)) throw new Error("The model gateway response has no message.");
  const message = choice.message;
  const content = typeof message.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map(parseToolCall)
    : [];
  const result: ModelResponse = { content, toolCalls };
  if (typeof value.model === "string") result.model = value.model;
  if (isRecord(value.usage)) {
    result.usage = {
      ...(typeof value.usage.prompt_tokens === "number" ? { inputTokens: value.usage.prompt_tokens } : {}),
      ...(typeof value.usage.completion_tokens === "number" ? { outputTokens: value.usage.completion_tokens } : {}),
      ...(typeof value.usage.total_tokens === "number" ? { totalTokens: value.usage.total_tokens } : {})
    };
  }
  return result;
}

function parseToolCall(value: unknown): ModelToolCall {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.function) || typeof value.function.name !== "string") {
    throw new Error("The model gateway returned a malformed tool call.");
  }
  let args: unknown = {};
  if (typeof value.function.arguments === "string" && value.function.arguments) {
    try {
      args = JSON.parse(value.function.arguments) as unknown;
    } catch {
      throw new Error(`Tool call ${value.function.name} returned invalid JSON arguments.`);
    }
  }
  return { id: value.id, name: value.function.name, arguments: args };
}

function ensureTrailingSlash(value: URL): URL {
  const copy = new URL(value);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
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

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value.endsWith(".localhost") || value === "127.0.0.1" || value === "::1";
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

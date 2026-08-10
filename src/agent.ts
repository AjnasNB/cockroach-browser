import type { ActionReceipt, BrowserAction, PageSnapshot } from "./contracts.js";
import type { BrowserRuntime } from "./runtime.js";
import type {
  ModelGateway,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelToolDefinition
} from "./model-gateway.js";

export interface BrowserAgentOptions {
  runtime: BrowserRuntime;
  gateway: ModelGateway;
  maxSteps?: number;
  maxOutputTokens?: number;
  systemPrompt?: string;
}

export interface BrowserAgentRunInput {
  sessionId: string;
  task: string;
  signal?: AbortSignal;
}

export interface BrowserAgentStep {
  index: number;
  tool: "browser_snapshot" | "browser_action" | "browser_finish";
  input: unknown;
  output: unknown;
  receipt?: ActionReceipt;
}

export interface BrowserAgentRunResult {
  status: "completed" | "step-limit";
  result: string;
  steps: BrowserAgentStep[];
  finalSnapshot: PageSnapshot;
}

const AGENT_TOOLS: ModelToolDefinition[] = [
  {
    name: "browser_snapshot",
    description: "Observe the current browser page as bounded semantic text and references.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { tabId: { type: "string" } }
    }
  },
  {
    name: "browser_action",
    description: "Execute one typed Cockroach Browser action. The runtime still enforces session policy and approvals.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "object",
          required: ["kind"],
          additionalProperties: true,
          properties: { kind: { type: "string" } }
        }
      }
    }
  },
  {
    name: "browser_finish",
    description: "Finish the task with a concise result grounded in observed browser state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["result"],
      properties: { result: { type: "string", maxLength: 32_000 } }
    }
  }
];

export class BrowserAgent {
  readonly runtime: BrowserRuntime;
  readonly gateway: ModelGateway;
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
  readonly systemPrompt: string;

  constructor(options: BrowserAgentOptions) {
    this.runtime = options.runtime;
    this.gateway = options.gateway;
    this.maxSteps = integer(options.maxSteps ?? 40, 1, 200, "maxSteps");
    this.maxOutputTokens = integer(options.maxOutputTokens ?? 2_048, 64, 32_768, "maxOutputTokens");
    this.systemPrompt = options.systemPrompt ?? [
      "You are a browser task planner.",
      "Use semantic snapshots before acting and after state changes.",
      "Use only the supplied typed browser tools.",
      "Never invent a successful outcome; finish only from observed state.",
      "The browser runtime independently enforces origins, effects, approvals, and budgets."
    ].join(" ");
  }

  async run(input: BrowserAgentRunInput): Promise<BrowserAgentRunResult> {
    if (!input.task.trim() || input.task.length > 32_000) throw new TypeError("A bounded agent task is required.");
    const initial = await this.runtime.snapshot(input.sessionId);
    const messages: ModelMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: `${input.task}\n\nInitial browser snapshot:\n${JSON.stringify(initial)}` }
    ];
    const steps: BrowserAgentStep[] = [];
    let lastContent = "";
    for (let index = 0; index < this.maxSteps; index += 1) {
      if (input.signal?.aborted) throw new Error("The browser agent run was aborted.");
      const request: ModelRequest = {
        messages,
        tools: AGENT_TOOLS,
        maxOutputTokens: this.maxOutputTokens,
        ...(input.signal ? { signal: input.signal } : {})
      };
      const response = await this.gateway.complete(request);
      lastContent = response.content || lastContent;
      messages.push({ role: "assistant", content: response.content });
      if (response.toolCalls.length === 0) {
        const finalSnapshot = await this.runtime.snapshot(input.sessionId);
        return { status: "completed", result: response.content, steps, finalSnapshot };
      }
      for (const call of response.toolCalls) {
        const handled = await this.#tool(input, call, index, steps);
        messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: JSON.stringify(handled)
        });
        if (handled.finished) {
          const finalSnapshot = await this.runtime.snapshot(input.sessionId);
          return { status: "completed", result: handled.result, steps, finalSnapshot };
        }
      }
    }
    const finalSnapshot = await this.runtime.snapshot(input.sessionId);
    return {
      status: "step-limit",
      result: lastContent || "The browser agent reached its configured step limit.",
      steps,
      finalSnapshot
    };
  }

  async #tool(
    run: BrowserAgentRunInput,
    call: ModelToolCall,
    index: number,
    steps: BrowserAgentStep[]
  ): Promise<{ finished: boolean; result: string; output?: unknown }> {
    const args = record(call.arguments, call.name);
    if (call.name === "browser_snapshot") {
      const tabId = typeof args.tabId === "string" ? args.tabId : undefined;
      const snapshot = await this.runtime.snapshot(run.sessionId, tabId);
      steps.push({ index, tool: call.name, input: args, output: snapshot });
      return { finished: false, result: "", output: snapshot };
    }
    if (call.name === "browser_action") {
      const actionValue = record(args.action, "browser_action.action");
      if (typeof actionValue.kind !== "string") throw new TypeError("browser_action requires action.kind.");
      const action = {
        ...actionValue,
        purpose: typeof actionValue.purpose === "string"
          ? actionValue.purpose
          : `Agent step ${index + 1}: ${run.task.slice(0, 512)}`
      } as unknown as BrowserAction;
      const executed = await this.runtime.act(run.sessionId, action);
      steps.push({ index, tool: call.name, input: action, output: executed.output, receipt: executed.receipt });
      return {
        finished: false,
        result: "",
        output: { output: executed.output, receipt: executed.receipt }
      };
    }
    if (call.name === "browser_finish") {
      if (typeof args.result !== "string" || !args.result || args.result.length > 32_000) {
        throw new TypeError("browser_finish requires a bounded result string.");
      }
      steps.push({ index, tool: call.name, input: args, output: args.result });
      return { finished: true, result: args.result };
    }
    throw new TypeError(`Unknown browser agent tool: ${call.name}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

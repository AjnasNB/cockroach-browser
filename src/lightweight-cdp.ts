import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, connect } from "node:net";
import { resolve } from "node:path";
import type { ActionKind } from "./contracts.js";
import {
  EngineCapabilityPreflightError,
  engineCapabilitiesForAction,
  preflightEngineActions,
  type EngineCapabilityCheck,
  type EngineCapabilityPreflightResult
} from "./engine-capabilities.js";
import { CockroachBrowserError } from "./errors.js";
import { listProcessTreePids, sampleProcessTree, type ProcessTreeSample } from "./resource-usage.js";

export type LightweightCdpImplementationId = "obscura" | "lightpanda";
export type LightweightCdpRendering = "none" | "native";
export type LightweightCdpResourceProfile = "standard" | "constrained";

export interface LightweightCdpImplementation {
  id: LightweightCdpImplementationId;
  displayName: string;
  license: "Apache-2.0" | "AGPL-3.0-only";
  cdpCompatibility: "partial";
  rendering: "binary-dependent" | "none";
  nativePlatforms: readonly NodeJS.Platform[];
  windowsSupport: "native" | "wsl2-only";
  endpointPath: string;
}

const IMPLEMENTATIONS: Readonly<Record<LightweightCdpImplementationId, LightweightCdpImplementation>> = Object.freeze({
  obscura: Object.freeze({
    id: "obscura",
    displayName: "Obscura",
    license: "Apache-2.0",
    cdpCompatibility: "partial",
    rendering: "binary-dependent",
    nativePlatforms: Object.freeze(["linux", "darwin", "win32"] as const),
    windowsSupport: "native",
    endpointPath: ""
  }),
  lightpanda: Object.freeze({
    id: "lightpanda",
    displayName: "Lightpanda",
    license: "AGPL-3.0-only",
    cdpCompatibility: "partial",
    rendering: "none",
    nativePlatforms: Object.freeze(["linux", "darwin"] as const),
    windowsSupport: "wsl2-only",
    endpointPath: ""
  })
});

export interface LightweightCdpLaunchInput {
  /** Explicit third-party executable. This module never downloads a browser. */
  executablePath: string;
  implementation: LightweightCdpImplementationId;
  /** Optional release/build digest, as 64 hexadecimal characters or sha256:<hex>. */
  expectedSha256?: string;
  /** Loopback port. Omit to reserve an ephemeral port. */
  port?: number;
  /** Time allowed for the local CDP listener to become reachable. */
  startupTimeoutMs?: number;
  /** Maximum retained bytes for each stdout/stderr diagnostic tail. */
  maxLogBytes?: number;
  /** Cockroach visual-action contract. Omission fails closed to denying visual actions; it does not imply a binary launch switch. */
  rendering?: LightweightCdpRendering;
  /** Fixed Obscura-only memory profile. Constrained mode trades site capacity for a lower heap ceiling. */
  resourceProfile?: LightweightCdpResourceProfile;
  /** Permit private/loopback page targets only when the enclosing browser policy explicitly permits them. */
  allowPrivateNetwork?: boolean;
  /** Bounded actions that this owned process is expected to execute. */
  requiredActions: readonly ActionKind[];
  /** Required before relying on any capability not yet proven by repository conformance. */
  allowExperimentalCapabilities?: boolean;
  /** Benchmark/telemetry hook invoked immediately after the owned child starts. */
  onSpawn?: (pid: number) => void;
}

export interface LightweightCdpLaunchPlan {
  implementation: LightweightCdpImplementation;
  executablePath: string;
  host: "127.0.0.1";
  port: number;
  endpoint: string;
  args: readonly string[];
  rendering: LightweightCdpRendering;
  resourceProfile: LightweightCdpResourceProfile;
  allowPrivateNetwork: boolean;
}

export interface LightweightCdpCapabilityPreflight extends EngineCapabilityPreflightResult {
  implementation: LightweightCdpImplementationId;
  rendering: LightweightCdpRendering;
}

export interface LightweightCdpExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class ManagedLightweightCdpProcess {
  readonly implementation: LightweightCdpImplementation;
  readonly executablePath: string;
  readonly endpoint: string;
  readonly plannedEndpoint: string;
  readonly reportedEndpoint: string | undefined;
  readonly host = "127.0.0.1" as const;
  readonly port: number;
  readonly pid: number;
  readonly rendering: LightweightCdpRendering;
  readonly resourceProfile: LightweightCdpResourceProfile;
  readonly capabilityPreflight: LightweightCdpCapabilityPreflight;
  readonly exit: Promise<LightweightCdpExit>;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #stdout: CappedByteTail;
  readonly #stderr: CappedByteTail;
  readonly #ownedPids: Set<number>;
  #closePromise: Promise<void> | undefined;

  constructor(
    plan: LightweightCdpLaunchPlan,
    child: ChildProcessWithoutNullStreams,
    stdout: CappedByteTail,
    stderr: CappedByteTail,
    capabilityPreflight: LightweightCdpCapabilityPreflight,
    reportedEndpoint?: string,
    ownedPids: readonly number[] = []
  ) {
    if (!child.pid) throw new CockroachBrowserError("LIGHTWEIGHT_CDP_START_FAILED", "The lightweight browser did not expose a process ID.");
    this.implementation = plan.implementation;
    this.executablePath = plan.executablePath;
    this.plannedEndpoint = plan.endpoint;
    this.reportedEndpoint = reportedEndpoint;
    this.endpoint = reportedEndpoint ?? plan.endpoint;
    this.port = plan.port;
    this.rendering = plan.rendering;
    this.resourceProfile = plan.resourceProfile;
    this.capabilityPreflight = capabilityPreflight;
    this.pid = child.pid;
    this.#child = child;
    this.#stdout = stdout;
    this.#stderr = stderr;
    this.#ownedPids = new Set([this.pid, ...ownedPids]);
    this.exit = new Promise((settle) => {
      child.once("exit", (code, signal) => settle({ code, signal }));
    });
  }

  get stdoutTail(): string {
    return this.#stdout.text();
  }

  get stderrTail(): string {
    return this.#stderr.text();
  }

  get running(): boolean {
    return this.#child.exitCode === null && this.#child.signalCode === null;
  }

  /** Browser-process-tree RSS and CPU only; it does not include the caller's Node process. */
  async resources(): Promise<ProcessTreeSample> {
    const [sample, pids] = await Promise.all([
      sampleProcessTree(this.pid),
      listProcessTreePids(this.pid)
    ]);
    pids.forEach((pid) => this.#ownedPids.add(pid));
    return sample;
  }

  async assertEndpointOwnership(): Promise<void> {
    const pids = await assertLoopbackListenerOwned(this.pid, this.port);
    pids.forEach((pid) => this.#ownedPids.add(pid));
  }

  preflightActions(actions: readonly ActionKind[]): LightweightCdpCapabilityPreflight {
    return preflightLightweightCdpActions({
      implementation: this.implementation.id,
      rendering: this.rendering,
      actions,
      allowExperimentalCapabilities: this.capabilityPreflight.allowExperimental
    });
  }

  assertActions(actions: readonly ActionKind[]): LightweightCdpCapabilityPreflight {
    return assertLightweightCdpActions({
      implementation: this.implementation.id,
      rendering: this.rendering,
      actions,
      allowExperimentalCapabilities: this.capabilityPreflight.allowExperimental
    });
  }

  close(timeoutMs = 5_000): Promise<void> {
    if (!this.#closePromise) {
      const attempt = closeOwnedProcessTree(this.#child, boundedTimeout(timeoutMs, "close"), this.#ownedPids);
      let wrapped: Promise<void>;
      wrapped = attempt.catch((error) => {
        if (this.#closePromise === wrapped) this.#closePromise = undefined;
        throw error;
      });
      this.#closePromise = wrapped;
    }
    return this.#closePromise;
  }
}

export function lightweightCdpImplementation(id: LightweightCdpImplementationId): LightweightCdpImplementation {
  const implementation = IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_IMPLEMENTATION_INVALID", `Unknown lightweight CDP implementation: ${String(id)}.`);
  }
  return implementation;
}

export function buildLightweightCdpLaunchPlan(
  implementationId: LightweightCdpImplementationId,
  executablePath: string,
  port: number,
  rendering: LightweightCdpRendering = "none",
  resourceProfile: LightweightCdpResourceProfile = "standard",
  allowPrivateNetwork = false
): LightweightCdpLaunchPlan {
  const implementation = lightweightCdpImplementation(implementationId);
  assertRendering(implementation, rendering);
  assertResourceProfile(implementation, resourceProfile);
  if (allowPrivateNetwork && implementation.id !== "obscura") {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_PRIVATE_NETWORK_UNSUPPORTED",
      "Private-network launch authorization is reviewed only for Obscura."
    );
  }
  assertPort(port);
  const host = "127.0.0.1" as const;
  const args = Object.freeze(implementationId === "obscura"
    ? [
        ...(resourceProfile === "constrained"
          ? ["--v8-flags", "--max-old-space-size=8 --max-semi-space-size=1"]
          : []),
        "serve", "--host", host, "--port", String(port), "--workers", "1", "--max-connections", "1", "--quiet",
        ...(allowPrivateNetwork ? ["--allow-private-network"] : [])
      ]
    : ["serve", "--host", host, "--port", String(port)]);
  return Object.freeze({
    implementation,
    executablePath,
    host,
    port,
    endpoint: `ws://${host}:${port}${implementation.endpointPath}`,
    args,
    rendering,
    resourceProfile,
    allowPrivateNetwork
  });
}

export interface LightweightCdpActionPreflightInput {
  implementation: LightweightCdpImplementationId;
  rendering?: LightweightCdpRendering;
  actions: readonly ActionKind[];
  allowExperimentalCapabilities?: boolean;
}

const RENDERING_CAPABILITIES = new Set(["capture.screenshot", "capture.pdf", "capture.video"] as const);
const NO_RENDER_DOM_ADAPTER_ACTIONS = new Set<ActionKind>(["click", "fill"]);
const NO_RENDER_VISUAL_ACTIONS = new Set<ActionKind>([
  "doubleClick", "type", "press", "hover", "focus", "check", "uncheck", "select", "scroll", "drag",
  "mouse.move", "mouse.down", "mouse.up", "mouse.click", "keyboard.down", "keyboard.up", "keyboard.insertText",
  "download"
]);

export function preflightLightweightCdpActions(
  input: LightweightCdpActionPreflightInput
): LightweightCdpCapabilityPreflight {
  const implementation = lightweightCdpImplementation(input.implementation);
  const rendering = input.rendering ?? "none";
  assertRendering(implementation, rendering);
  const base = preflightEngineActions({
    engine: implementation.id,
    actions: input.actions,
    ...(input.allowExperimentalCapabilities !== undefined
      ? { allowExperimental: input.allowExperimentalCapabilities }
      : {})
  });
  const deniedByVariant = new Set(
    input.actions.flatMap((action) => rendering === "none"
      ? engineCapabilitiesForAction(action).filter((capability) => RENDERING_CAPABILITIES.has(
          capability as "capture.screenshot" | "capture.pdf" | "capture.video"
        ))
      : [])
  );
  const deniedVisualActions = rendering === "none"
    ? input.actions.filter((action) => NO_RENDER_VISUAL_ACTIONS.has(action) && !NO_RENDER_DOM_ADAPTER_ACTIONS.has(action))
    : [];
  const deniedVisualCapabilities = new Set(
    deniedVisualActions.flatMap((action) => engineCapabilitiesForAction(action))
  );
  const checks = base.checks.map((check): EngineCapabilityCheck => {
    const deniedVisual = deniedVisualCapabilities.has(check.capability);
    return deniedByVariant.has(check.capability) || deniedVisual
      ? Object.freeze({
          ...check,
          state: "unsupported",
          accepted: false,
          note: deniedVisual
            ? `The exact ${implementation.displayName} non-visual lane has no visual pointer fidelity for: ${deniedVisualActions.join(", ")}. Only DOM activation click and fill are adapted.`
            : `Cockroach Browser's exact ${implementation.displayName} route declares the rendering=none visual-action policy; no engine renderer state is asserted.`
        })
      : check;
  });
  const unmet = checks.filter((check) => !check.accepted);
  return Object.freeze({
    ...base,
    ok: unmet.length === 0,
    checks: Object.freeze(checks),
    unmet: Object.freeze(unmet),
    implementation: implementation.id,
    rendering
  });
}

export function assertLightweightCdpActions(
  input: LightweightCdpActionPreflightInput
): LightweightCdpCapabilityPreflight {
  const result = preflightLightweightCdpActions(input);
  if (!result.ok) throw new EngineCapabilityPreflightError(result);
  return result;
}

export async function launchLightweightCdp(
  input: LightweightCdpLaunchInput
): Promise<ManagedLightweightCdpProcess> {
  const implementation = lightweightCdpImplementation(input.implementation);
  if (implementation.id === "lightpanda") {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_NETWORK_BOUNDARY_UNAVAILABLE",
      "The managed Lightpanda runtime is disabled until a deny-by-default engine or operating-system egress boundary covers HTTP, WebSocket, worker, WebRTC, and WebTransport channels. Its capability manifest remains available for discovery and benchmark planning."
    );
  }
  const rendering = input.rendering ?? "none";
  const capabilityPreflight = assertLightweightCdpActions({
    implementation: implementation.id,
    rendering,
    actions: input.requiredActions,
    ...(input.allowExperimentalCapabilities !== undefined
      ? { allowExperimentalCapabilities: input.allowExperimentalCapabilities }
      : {})
  });
  if (!implementation.nativePlatforms.includes(process.platform)) {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_PLATFORM_UNSUPPORTED",
      `${implementation.displayName} has no native ${process.platform} binary. On Windows its supported boundary is ${implementation.windowsSupport}.`
    );
  }
  const executablePath = await assertExecutable(input.executablePath);
  if (input.expectedSha256) await assertSha256(executablePath, input.expectedSha256);
  const port = input.port ?? await reserveLoopbackPort();
  assertPort(port);
  await assertLoopbackPortAvailable(port);
  const startupTimeoutMs = boundedTimeout(input.startupTimeoutMs ?? 15_000, "startup");
  const maxLogBytes = boundedLogBytes(input.maxLogBytes ?? 64 * 1024);
  const resourceProfile = input.resourceProfile ?? "standard";
  const plan = buildLightweightCdpLaunchPlan(
    input.implementation,
    executablePath,
    port,
    rendering,
    resourceProfile,
    input.allowPrivateNetwork ?? false
  );
  const child = spawn(executablePath, [...plan.args], {
    // A distinct process group makes tree termination deterministic. On
    // Windows, pairing detached with windowsHide prevents the console-subsystem
    // binary from allocating a separate conhost process that adds no browser
    // capability but must otherwise be counted in the owned tree.
    detached: true,
    env: minimalBrowserEnvironment(input.implementation),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const stdout = new CappedByteTail(maxLogBytes);
  const stderr = new CappedByteTail(maxLogBytes);
  child.stdout.on("data", (chunk: Buffer | string) => stdout.append(chunk));
  child.stderr.on("data", (chunk: Buffer | string) => stderr.append(chunk));
  child.on("error", (error) => stderr.append(`[process error] ${error.message}\n`));
  await waitForSpawn(child).catch((error) => {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_START_FAILED",
      `${implementation.displayName} could not be executed: ${error instanceof Error ? error.message : String(error)}`,
      { implementation: implementation.id, executablePath }
    );
  });
  try {
    input.onSpawn?.(child.pid!);
    child.stdin.end();
    const ownedPids = await waitForLoopbackListener(child, port, startupTimeoutMs);
    const reportedEndpoint = parseLightweightCdpReportedEndpoint(`${stdout.text()}\n${stderr.text()}`, port);
    return new ManagedLightweightCdpProcess(plan, child, stdout, stderr, capabilityPreflight, reportedEndpoint, ownedPids);
  } catch (error) {
    let cleanupError: unknown;
    try {
      await closeOwnedProcessTree(child, 5_000, new Set(child.pid ? [child.pid] : []));
    } catch (caught) {
      cleanupError = caught;
    }
    const details = {
      implementation: implementation.id,
      executablePath,
      port,
      stdoutTail: stdout.text(),
      stderrTail: stderr.text()
    };
    if (cleanupError) {
      throw new CockroachBrowserError(
        "LIGHTWEIGHT_CDP_START_CLEANUP_FAILED",
        `The lightweight browser failed to start and its complete process tree could not be verified as closed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        {
          ...details,
          startFailure: error instanceof Error ? error.message : String(error),
          cleanupFailure: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }
      );
    }
    if (error instanceof CockroachBrowserError) {
      throw new CockroachBrowserError(error.code, error.message, details);
    }
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_START_FAILED",
      `${implementation.displayName} did not start its loopback CDP listener: ${error instanceof Error ? error.message : String(error)}`,
      details
    );
  }
}

function assertRendering(
  implementation: LightweightCdpImplementation,
  rendering: LightweightCdpRendering
): void {
  if (rendering !== "none" && rendering !== "native") {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_RENDERING_INVALID", `Unknown rendering variant: ${String(rendering)}.`);
  }
  if (rendering === "native" && implementation.rendering === "none") {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_RENDERING_UNSUPPORTED",
      `${implementation.displayName} has no native-rendering variant in the owned lightweight lane.`
    );
  }
}

function assertResourceProfile(
  implementation: LightweightCdpImplementation,
  resourceProfile: LightweightCdpResourceProfile
): void {
  if (resourceProfile !== "standard" && resourceProfile !== "constrained") {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_RESOURCE_PROFILE_INVALID",
      `Unknown lightweight resource profile: ${String(resourceProfile)}.`
    );
  }
  if (resourceProfile === "constrained" && implementation.id !== "obscura") {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_RESOURCE_PROFILE_UNSUPPORTED",
      "The constrained resource profile is reviewed only for Obscura."
    );
  }
}

/**
 * Accept only a WebSocket endpoint actually reported for this owned loopback
 * listener. A third-party binary cannot redirect the client to another host or
 * port through its diagnostic output.
 */
export function parseLightweightCdpReportedEndpoint(output: string, expectedPort: number): string | undefined {
  assertPort(expectedPort);
  const candidates = output.match(/ws:\/\/127\.0\.0\.1:\d{1,5}(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?/g) ?? [];
  for (const candidate of candidates) {
    try {
      const endpoint = new URL(candidate);
      if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || Number(endpoint.port) !== expectedPort) continue;
      endpoint.hash = "";
      return endpoint.toString().replace(/\/$/, candidate.endsWith("/") ? "/" : "");
    } catch {
      // Ignore malformed diagnostics and retain the reviewed bare endpoint.
    }
  }
  return undefined;
}

async function assertExecutable(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await lstat(absolute).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_EXECUTABLE_INVALID", "The lightweight browser must be an explicit regular file, not a symlink.");
  }
  await access(absolute, process.platform === "win32" ? constants.R_OK : constants.R_OK | constants.X_OK).catch(() => {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_EXECUTABLE_INVALID", "The lightweight browser executable is not readable and executable.");
  });
  return realpath(absolute);
}

async function assertSha256(path: string, expected: string): Promise<void> {
  const normalized = expected.toLowerCase().replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_DIGEST_INVALID", "Expected SHA-256 must contain exactly 64 hexadecimal characters.");
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const actual = digest.digest("hex");
  if (actual !== normalized) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_DIGEST_MISMATCH", "The lightweight browser executable does not match the reviewed SHA-256 digest.", {
      expected: normalized,
      actual
    });
  }
}

function minimalBrowserEnvironment(implementation: LightweightCdpImplementationId): NodeJS.ProcessEnv {
  const selected = [
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR"
  ];
  const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of selected) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  if (implementation === "lightpanda") {
    environment.LIGHTPANDA_DISABLE_TELEMETRY = "true";
    environment.LIGHTPANDA_DISABLE_CORE_DUMP = "1";
  }
  return environment;
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((settle, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback port.")));
        return;
      }
      server.close((error) => error ? reject(error) : settle(address.port));
    });
  });
}

async function assertLoopbackPortAvailable(port: number): Promise<void> {
  return new Promise((settle, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () => reject(new CockroachBrowserError("LIGHTWEIGHT_CDP_PORT_UNAVAILABLE", `Loopback port ${port} is already in use.`)));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : settle()));
  });
}

async function waitForLoopbackListener(
  child: ChildProcessWithoutNullStreams,
  port: number,
  timeoutMs: number
): Promise<readonly number[]> {
  const startedAt = Date.now();
  let foreignListenerDetected = false;
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_START_FAILED", "The lightweight browser exited before its CDP listener became ready.");
    }
    if (await canConnectLoopback(port)) {
      try {
        return await assertLoopbackListenerOwned(child.pid!, port);
      } catch (error) {
        if (error instanceof CockroachBrowserError && error.code === "LIGHTWEIGHT_CDP_LISTENER_NOT_OWNED") {
          foreignListenerDetected = true;
        } else {
          throw error;
        }
      }
    }
    await delay(Math.min(50, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
  if (foreignListenerDetected) {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_LISTENER_NOT_OWNED",
      `A process outside the spawned lightweight browser tree owns loopback port ${port}.`
    );
  }
  throw new CockroachBrowserError("LIGHTWEIGHT_CDP_START_TIMEOUT", `The lightweight browser did not listen on loopback within ${timeoutMs} milliseconds.`);
}

function canConnectLoopback(port: number): Promise<boolean> {
  return new Promise((settle) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (connected: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      settle(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function assertLoopbackListenerOwned(rootPid: number, port: number): Promise<readonly number[]> {
  assertPort(port);
  const tree = await listProcessTreePids(rootPid).catch((error) => {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_LISTENER_OWNERSHIP_UNAVAILABLE",
      `The spawned process tree could not be enumerated: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  const owners = await loopbackListenerOwnerPids(port).catch((error) => {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_LISTENER_OWNERSHIP_UNAVAILABLE",
      `The loopback listener owner could not be verified: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  const treeSet = new Set(tree);
  if (owners.length === 0 || !owners.every((pid) => treeSet.has(pid))) {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_LISTENER_NOT_OWNED",
      `Loopback port ${port} is not owned by the spawned lightweight browser process tree.`,
      { rootPid, processTreePids: tree, listenerOwnerPids: owners }
    );
  }
  return tree;
}

async function loopbackListenerOwnerPids(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    return parseWindowsNetstatListenerPids(
      await execFileText(trustedWindowsSystemExecutable("netstat.exe"), ["-ano", "-p", "TCP"]),
      port
    );
  }
  if (process.platform === "linux") return linuxLoopbackListenerPids(port);
  if (process.platform === "darwin") {
    const output = await execFileText("/usr/sbin/lsof", ["-nP", `-iTCP@127.0.0.1:${port}`, "-sTCP:LISTEN", "-Fp"]);
    return [...new Set(output.split(/\r?\n/).filter((line) => /^p\d+$/.test(line)).map((line) => Number(line.slice(1))))];
  }
  throw new Error(`Listener ownership verification is unavailable on ${process.platform}.`);
}

export function parseWindowsNetstatListenerPids(output: string, port: number): number[] {
  assertPort(port);
  const pattern = new RegExp(`^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, "i");
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return [...new Set(pids)].sort((left, right) => left - right);
}

async function linuxLoopbackListenerPids(port: number): Promise<number[]> {
  const expectedPort = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set<string>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const source = await readFile(table, "utf8").catch(() => "");
    for (const line of source.split(/\r?\n/).slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== "0A") continue;
      const [address, candidatePort] = (fields[1] ?? "").split(":");
      const isLoopback = address === "0100007F"
        || address === "0000000000000000FFFF00000100007F";
      if (isLoopback && candidatePort === expectedPort && fields[9]) inodes.add(fields[9]);
    }
  }
  if (inodes.size === 0) return [];
  const pids: number[] = [];
  const procEntries = await readdir("/proc", { withFileTypes: true });
  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const descriptors = await readdir(`/proc/${entry.name}/fd`).catch(() => []);
    let owns = false;
    for (const descriptor of descriptors.slice(0, 65_536)) {
      const target = await readlink(`/proc/${entry.name}/fd/${descriptor}`).catch(() => "");
      const match = target.match(/^socket:\[(\d+)\]$/);
      if (match?.[1] && inodes.has(match[1])) {
        owns = true;
        break;
      }
    }
    if (owns) pids.push(Number(entry.name));
  }
  return pids.sort((left, right) => left - right);
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((settle, reject) => {
    execFile(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => error ? reject(error) : settle(stdout));
  });
}

async function closeOwnedProcessTree(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  knownPids: Set<number>
): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (process.platform === "win32") {
      const survivors = [...knownPids].filter(processExists);
      await Promise.all(survivors.map((ownedPid) => runTaskkill(ownedPid).catch(() => undefined)));
      throw new CockroachBrowserError(
        "LIGHTWEIGHT_CDP_PROCESS_TREE_ORPHANED",
        "The lightweight browser leader exited before teardown. Windows cannot prove that no unobserved descendant escaped without a Job Object, so cleanup is reported as unverified.",
        { rootPid: pid, survivorPids: survivors }
      );
    }
    terminateProcessGroup(pid, "SIGTERM");
    if (!(await waitForProcessGroupExit(pid, timeoutMs))) terminateProcessGroup(pid, "SIGKILL");
    if (await waitForProcessGroupExit(pid, Math.min(timeoutMs, 5_000))) return;
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_PROCESS_TREE_ORPHANED",
      "The lightweight browser leader exited while its detached process group was still alive.",
      { rootPid: pid }
    );
  }
  const currentTree = await listProcessTreePids(pid).catch(() => [pid]);
  currentTree.forEach((ownedPid) => knownPids.add(ownedPid));
  if (process.platform === "win32") {
    await runTaskkill(pid).catch(() => child.kill("SIGKILL"));
  } else {
    terminateProcessGroup(pid, "SIGTERM");
    if (!(await waitForProcessGroupExit(pid, timeoutMs))) {
      terminateProcessGroup(pid, "SIGKILL");
    }
  }
  const leaderExited = await waitForExit(child, Math.min(timeoutMs, 5_000));
  const deadline = Date.now() + Math.min(timeoutMs, 5_000);
  while (Date.now() < deadline && [...knownPids].some(processExists)) await delay(25);
  const survivors = [...knownPids].filter(processExists);
  if (!leaderExited || survivors.length > 0) {
    throw new CockroachBrowserError(
      "LIGHTWEIGHT_CDP_PROCESS_TREE_CLOSE_FAILED",
      "The runtime could not confirm that the complete lightweight browser process tree exited.",
      { rootPid: pid, leaderExited, survivorPids: survivors }
    );
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid) return Promise.resolve();
  return new Promise((settle, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError);
      settle();
    };
    const onError = (error: Error): void => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise((settle, reject) => {
    execFile(trustedWindowsSystemExecutable("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 5_000
    }, (error) => error ? reject(error) : settle());
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function processGroupExists(pid: number): boolean {
  if (process.platform === "win32") return processExists(pid);
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await delay(25);
  }
  return !processGroupExists(pid);
}

function trustedWindowsSystemExecutable(file: "netstat.exe" | "taskkill.exe"): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !/^[a-z]:[\\/]windows[\\/]?$/i.test(systemRoot)) {
    throw new CockroachBrowserError(
      "WINDOWS_SYSTEM_ROOT_UNTRUSTED",
      "A canonical drive-root Windows directory is required to invoke trusted operating-system process tools."
    );
  }
  return resolve(systemRoot, "System32", file);
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((settle) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      settle(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      settle(true);
    };
    child.once("exit", onExit);
  });
}

function boundedTimeout(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 250 || value > 120_000) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_TIMEOUT_INVALID", `${label} timeout must be between 250 and 120000 milliseconds.`);
  }
  return value;
}

function boundedLogBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 1024 * 1024) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_LOG_LIMIT_INVALID", "Diagnostic log retention must be between 1024 bytes and 1 MiB per stream.");
  }
  return value;
}

function assertPort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new CockroachBrowserError("LIGHTWEIGHT_CDP_PORT_INVALID", "CDP port must be an integer between 1 and 65535.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}

class CappedByteTail {
  readonly limit: number;
  #value: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(limit: number) {
    this.limit = limit;
  }

  append(value: Buffer | string): void {
    const incoming = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (incoming.length >= this.limit) {
      this.#value = incoming.subarray(incoming.length - this.limit);
      return;
    }
    const combined = Buffer.concat([this.#value, incoming]);
    this.#value = combined.length > this.limit ? combined.subarray(combined.length - this.limit) : combined;
  }

  text(): string {
    return this.#value.toString("utf8");
  }
}

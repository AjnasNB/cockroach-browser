import { execFile } from "node:child_process";
import type { BrowserResourceUsage, ResourceBudget } from "./contracts.js";

export interface ProcessRecord {
  pid: number;
  parentPid: number;
  rssBytes: number;
  cpuTimeMs: number;
}

export interface ProcessTreeSample {
  sampledAt: string;
  rootPid: number;
  processCount: number;
  rssBytes: number;
  cpuTimeMs: number;
}

export type ProcessTreeSampler = (rootPid: number) => Promise<ProcessTreeSample>;

const WINDOWS_PROCESS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$items=Get-CimInstance Win32_Process | ForEach-Object {",
  "[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;rssBytes=[double]$_.WorkingSetSize;cpuTimeMs=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000}",
  "}",
  "$items | ConvertTo-Json -Compress"
].join("; ");

export function aggregateProcessTree(rootPid: number, records: readonly ProcessRecord[]): ProcessTreeSample {
  assertPid(rootPid);
  const byParent = new Map<number, ProcessRecord[]>();
  const byPid = new Map<number, ProcessRecord>();
  for (const record of records) {
    if (!validRecord(record)) continue;
    byPid.set(record.pid, record);
    const children = byParent.get(record.parentPid) ?? [];
    children.push(record);
    byParent.set(record.parentPid, children);
  }
  if (!byPid.has(rootPid)) throw new Error(`Browser process ${rootPid} is no longer running.`);
  const selected: ProcessRecord[] = [];
  const pending = [rootPid];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const pid = pending.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const record = byPid.get(pid);
    if (record) selected.push(record);
    for (const child of byParent.get(pid) ?? []) pending.push(child.pid);
  }
  return {
    sampledAt: new Date().toISOString(),
    rootPid,
    processCount: selected.length,
    rssBytes: Math.round(selected.reduce((total, record) => total + record.rssBytes, 0)),
    cpuTimeMs: Math.round(selected.reduce((total, record) => total + record.cpuTimeMs, 0))
  };
}

export async function sampleProcessTree(rootPid: number): Promise<ProcessTreeSample> {
  assertPid(rootPid);
  const records = process.platform === "win32"
    ? await windowsProcessRecords()
    : await posixProcessRecords();
  return aggregateProcessTree(rootPid, records);
}

export class BrowserResourceTracker {
  readonly rootPid: number;
  readonly budget: Pick<ResourceBudget, "maxProcessRssBytes" | "maxProcessCpuTimeMs">;
  readonly sampleIntervalMs: number;
  readonly sampler: ProcessTreeSampler;
  #lastSampleAt = 0;
  #usage: BrowserResourceUsage;
  #sampleInFlight: Promise<BrowserResourceUsage> | undefined;

  constructor(input: {
    rootPid: number;
    budget: Pick<ResourceBudget, "maxProcessRssBytes" | "maxProcessCpuTimeMs">;
    sampleIntervalMs?: number;
    sampler?: ProcessTreeSampler;
  }) {
    assertPid(input.rootPid);
    this.rootPid = input.rootPid;
    this.budget = { ...input.budget };
    this.sampleIntervalMs = boundedInterval(input.sampleIntervalMs ?? 2_000);
    this.sampler = input.sampler ?? sampleProcessTree;
    this.#usage = {
      ownership: "runtime-owned",
      available: false,
      limitState: "unavailable",
      maxProcessRssBytes: this.budget.maxProcessRssBytes,
      maxProcessCpuTimeMs: this.budget.maxProcessCpuTimeMs,
      reason: "No process-tree sample has been collected yet."
    };
  }

  async sample(force = false): Promise<BrowserResourceUsage> {
    const now = Date.now();
    if (!force && this.#lastSampleAt > 0 && now - this.#lastSampleAt < this.sampleIntervalMs) {
      return structuredClone(this.#usage);
    }
    if (this.#sampleInFlight) return structuredClone(await this.#sampleInFlight);
    const pending = this.#collect(now);
    this.#sampleInFlight = pending;
    try {
      return structuredClone(await pending);
    } finally {
      this.#sampleInFlight = undefined;
    }
  }

  async #collect(startedAt: number): Promise<BrowserResourceUsage> {
    try {
      const sample = await this.sampler(this.rootPid);
      const peakRssBytes = Math.max(this.#usage.peakRssBytes ?? 0, sample.rssBytes);
      const peakCpuTimeMs = Math.max(this.#usage.peakCpuTimeMs ?? 0, sample.cpuTimeMs);
      const exceeded = sample.rssBytes > this.budget.maxProcessRssBytes
        || sample.cpuTimeMs > this.budget.maxProcessCpuTimeMs;
      this.#usage = {
        ownership: "runtime-owned",
        available: true,
        sampledAt: sample.sampledAt,
        processCount: sample.processCount,
        rssBytes: sample.rssBytes,
        peakRssBytes,
        cpuTimeMs: sample.cpuTimeMs,
        peakCpuTimeMs,
        limitState: exceeded ? "exceeded" : "within",
        maxProcessRssBytes: this.budget.maxProcessRssBytes,
        maxProcessCpuTimeMs: this.budget.maxProcessCpuTimeMs
      };
    } catch (error) {
      this.#usage = {
        ...this.#usage,
        available: false,
        limitState: "unavailable",
        maxProcessRssBytes: this.budget.maxProcessRssBytes,
        maxProcessCpuTimeMs: this.budget.maxProcessCpuTimeMs,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
    this.#lastSampleAt = startedAt;
    return this.#usage;
  }

  current(): BrowserResourceUsage {
    return structuredClone(this.#usage);
  }
}

export function unavailableResourceUsage(
  budget: Pick<ResourceBudget, "maxProcessRssBytes" | "maxProcessCpuTimeMs">,
  reason: string,
  ownership: BrowserResourceUsage["ownership"] = "external"
): BrowserResourceUsage {
  return {
    ownership,
    available: false,
    limitState: "unavailable",
    maxProcessRssBytes: budget.maxProcessRssBytes,
    maxProcessCpuTimeMs: budget.maxProcessCpuTimeMs,
    reason
  };
}

async function windowsProcessRecords(): Promise<ProcessRecord[]> {
  const output = await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_PROCESS_SCRIPT
  ]);
  const parsed = JSON.parse(output) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter(isRecord).map((row) => ({
    pid: Number(row.pid),
    parentPid: Number(row.parentPid),
    rssBytes: Number(row.rssBytes),
    cpuTimeMs: Number(row.cpuTimeMs)
  }));
}

async function posixProcessRecords(): Promise<ProcessRecord[]> {
  const output = await run("ps", ["-e", "-o", "pid=", "-o", "ppid=", "-o", "rss=", "-o", "time="]);
  const records: ProcessRecord[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d:-]+)$/);
    if (!match) continue;
    records.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      cpuTimeMs: parseCpuTime(match[4]!)
    });
  }
  return records;
}

function parseCpuTime(value: string): number {
  const [dayPart, clockPart] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const units = (clockPart ?? "0").split(":").map(Number);
  const seconds = units.length === 3
    ? units[0]! * 3600 + units[1]! * 60 + units[2]!
    : units.length === 2
      ? units[0]! * 60 + units[1]!
      : units[0] ?? 0;
  return ((Number(dayPart) || 0) * 86_400 + seconds) * 1_000;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function validRecord(record: ProcessRecord): boolean {
  return Number.isSafeInteger(record.pid)
    && record.pid > 0
    && Number.isSafeInteger(record.parentPid)
    && record.parentPid >= 0
    && Number.isFinite(record.rssBytes)
    && record.rssBytes >= 0
    && Number.isFinite(record.cpuTimeMs)
    && record.cpuTimeMs >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function assertPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("A positive browser process id is required.");
}

function boundedInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 250 || value > 60_000) {
    throw new TypeError("Resource sample intervals must be between 250 and 60000 milliseconds.");
  }
  return value;
}

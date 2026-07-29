import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import type { ActionReceipt, EvidenceRecord } from "./contracts.js";
import { canonicalJson, newId, nowIso, sha256 } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

export interface EvidenceStoreOptions {
  root: string;
  maxBytes: number;
}

export class EvidenceStore {
  readonly root: string;
  readonly maxBytes: number;
  #records = new Map<string, EvidenceRecord>();
  #bytes = 0;
  #lastReceiptHash: string | undefined;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(options: EvidenceStoreOptions) {
    this.root = resolve(options.root);
    this.maxBytes = options.maxBytes;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(join(this.root, "artifacts"), { recursive: true });
    await mkdir(join(this.root, "receipts"), { recursive: true });
    const recordsPath = join(this.root, "records.json");
    try {
      const records = JSON.parse(await readFile(recordsPath, "utf8")) as EvidenceRecord[];
      for (const record of records) {
        this.#records.set(record.id, record);
        this.#bytes += record.size;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const receiptPath = join(this.root, "receipts", "head.txt");
    try {
      this.#lastReceiptHash = (await readFile(receiptPath, "utf8")).trim() || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const integrity = await this.verify();
    if (!integrity.ok) {
      throw new CockroachBrowserError(
        "EVIDENCE_INTEGRITY_FAILED",
        "The evidence ledger failed startup verification. Refusing to append to a corrupted or forked chain.",
        { failures: integrity.failures }
      );
    }
  }

  get usedBytes(): number {
    return this.#bytes;
  }

  get lastReceiptHash(): string | undefined {
    return this.#lastReceiptHash;
  }

  list(sessionId?: string): EvidenceRecord[] {
    return [...this.#records.values()]
      .filter((record) => !sessionId || record.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => structuredClone(record));
  }

  async addBuffer(input: {
    sessionId: string;
    kind: EvidenceRecord["kind"];
    contentType: string;
    data: Uint8Array;
    extension?: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EvidenceRecord> {
    return this.#exclusive(async () => this.#addBuffer(input));
  }

  async #addBuffer(input: {
    sessionId: string;
    kind: EvidenceRecord["kind"];
    contentType: string;
    data: Uint8Array;
    extension?: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EvidenceRecord> {
    const data = Buffer.from(input.data);
    this.#assertCapacity(data.byteLength);
    const id = newId("ev");
    const extension = sanitizeExtension(input.extension ?? extensionFor(input.contentType));
    const target = this.#safePath(join("artifacts", input.sessionId, `${id}${extension}`));
    await atomicWrite(target, data);
    const record: EvidenceRecord = {
      id,
      sessionId: input.sessionId,
      kind: input.kind,
      createdAt: nowIso(),
      contentType: input.contentType,
      path: relative(this.root, target).replaceAll("\\", "/"),
      size: data.byteLength,
      digest: sha256(data.toString("base64")),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {})
    };
    this.#records.set(id, record);
    this.#bytes += data.byteLength;
    await this.#persistRecords();
    return structuredClone(record);
  }

  async addJson(input: {
    sessionId: string;
    kind: EvidenceRecord["kind"];
    value: unknown;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EvidenceRecord> {
    return this.addBuffer({
      ...input,
      contentType: "application/json",
      extension: ".json",
      data: Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`)
    });
  }

  async appendReceipt(receipt: Omit<ActionReceipt, "previousReceiptHash" | "receiptHash">): Promise<ActionReceipt> {
    return this.#exclusive(async () => this.#appendReceipt(receipt));
  }

  async #appendReceipt(
    receipt: Omit<ActionReceipt, "previousReceiptHash" | "receiptHash">
  ): Promise<ActionReceipt> {
    const previousReceiptHash = this.#lastReceiptHash;
    const receiptHash = sha256({ ...receipt, previousReceiptHash });
    const complete: ActionReceipt = {
      ...receipt,
      ...(previousReceiptHash ? { previousReceiptHash } : {}),
      receiptHash
    };
    const target = this.#safePath(join("receipts", `${receipt.id}.json`));
    await atomicWrite(target, Buffer.from(`${JSON.stringify(complete, null, 2)}\n`));
    await atomicWrite(join(this.root, "receipts", "head.txt"), Buffer.from(`${receiptHash}\n`));
    this.#lastReceiptHash = receiptHash;
    return structuredClone(complete);
  }

  async verify(): Promise<{ ok: boolean; records: number; bytes: number; receiptHead?: string; failures: string[] }> {
    const failures: string[] = [];
    for (const record of this.#records.values()) {
      if (!record.path) continue;
      try {
        const data = await readFile(this.#safePath(record.path));
        const digest = sha256(data.toString("base64"));
        if (digest !== record.digest) failures.push(`${record.id}: digest mismatch`);
      } catch (error) {
        failures.push(`${record.id}: ${(error as Error).message}`);
      }
    }
    const receiptDirectory = join(this.root, "receipts");
    const receipts = new Map<string, ActionReceipt>();
    try {
      for (const entry of await readdir(receiptDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const receipt = JSON.parse(await readFile(join(receiptDirectory, entry.name), "utf8")) as ActionReceipt;
          const { receiptHash, ...unsigned } = receipt;
          if (sha256(unsigned) !== receiptHash) {
            failures.push(`${entry.name}: receipt digest mismatch`);
            continue;
          }
          if (receipts.has(receiptHash)) {
            failures.push(`${entry.name}: duplicate receipt hash`);
            continue;
          }
          receipts.set(receiptHash, receipt);
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
      const roots = [...receipts.values()].filter((receipt) => !receipt.previousReceiptHash);
      if (roots.length !== 1) {
        failures.push(`receipt chain: expected one root, found ${roots.length}`);
      } else {
        const byPrevious = new Map<string, ActionReceipt[]>();
        for (const receipt of receipts.values()) {
          if (!receipt.previousReceiptHash) continue;
          const children = byPrevious.get(receipt.previousReceiptHash) ?? [];
          children.push(receipt);
          byPrevious.set(receipt.previousReceiptHash, children);
        }
        let cursor: ActionReceipt | undefined = roots[0];
        const visited = new Set<string>();
        while (cursor) {
          if (visited.has(cursor.receiptHash)) {
            failures.push("receipt chain: cycle detected");
            break;
          }
          visited.add(cursor.receiptHash);
          const children = byPrevious.get(cursor.receiptHash) ?? [];
          if (children.length > 1) {
            failures.push(`${cursor.id}: receipt chain fork`);
            break;
          }
          cursor = children[0];
        }
        if (visited.size !== receipts.size) {
          failures.push(`receipt chain: ${receipts.size - visited.size} unlinked receipt(s)`);
        }
        const terminal = [...visited].at(-1);
        if (!this.#lastReceiptHash) {
          failures.push("receipt chain: verified receipts exist without a persisted head");
        } else if (terminal !== this.#lastReceiptHash) {
          failures.push("receipt chain: head does not match verified terminal receipt");
        }
      }
    } else if (this.#lastReceiptHash) {
      failures.push("receipt chain: head exists without receipt records");
    }
    return {
      ok: failures.length === 0,
      records: this.#records.size,
      bytes: this.#bytes,
      ...(this.#lastReceiptHash ? { receiptHead: this.#lastReceiptHash } : {}),
      failures
    };
  }

  async artifactPath(id: string): Promise<string> {
    const record = this.#records.get(id);
    if (!record?.path) throw new CockroachBrowserError("EVIDENCE_NOT_FOUND", `Evidence ${id} was not found.`);
    const path = this.#safePath(record.path);
    await stat(path);
    return path;
  }

  #assertCapacity(additional: number): void {
    if (additional < 0 || this.#bytes + additional > this.maxBytes) {
      throw new CockroachBrowserError("EVIDENCE_BUDGET_EXCEEDED", "The session evidence budget would be exceeded.");
    }
  }

  #safePath(path: string): string {
    const target = resolve(this.root, path);
    const relation = relative(this.root, target);
    if (relation.startsWith("..") || relation.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new CockroachBrowserError("PATH_OUTSIDE_EVIDENCE_ROOT", "Evidence paths must remain inside the evidence root.");
    }
    return target;
  }

  async #persistRecords(): Promise<void> {
    await atomicWrite(
      join(this.root, "records.json"),
      Buffer.from(`${JSON.stringify(this.list(), null, 2)}\n`)
    );
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const previous = this.#writeTail;
    this.#writeTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function atomicWrite(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}

function sanitizeExtension(extension: string): string {
  const normalized = extension.startsWith(".") ? extension : `.${extension}`;
  if (!/^\.[a-z0-9]{1,8}$/i.test(normalized)) return ".bin";
  return normalized.toLowerCase();
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "application/json") return ".json";
  if (contentType.includes("zip")) return ".zip";
  if (contentType.includes("text")) return ".txt";
  return ".bin";
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, nowIso } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

export type TeamSessionRole = "viewer" | "operator" | "owner";

export interface TeamSessionGrant {
  actor: string;
  role: TeamSessionRole;
  grantedAt: string;
  revokedAt?: string;
}

export interface TeamSessionAccess {
  sessionId: string;
  owner: string;
  generation: number;
  createdAt: string;
  grants: TeamSessionGrant[];
}

export class TeamSessionStore {
  readonly path: string;
  #entries = new Map<string, TeamSessionAccess>();
  #ready = false;
  #tail = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
  }

  async initialize(): Promise<void> {
    if (this.#ready) return;
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { version: 1; sessions: TeamSessionAccess[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error("invalid team session store");
      for (const entry of parsed.sessions) this.#entries.set(entry.sessionId, structuredClone(entry));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#ready = true;
  }

  async claim(sessionId: string, owner: string): Promise<TeamSessionAccess> {
    await this.initialize();
    return this.#mutate((entries) => {
      if (entries.has(sessionId)) throw new CockroachBrowserError("SESSION_ACCESS_EXISTS", `Access record for ${sessionId} already exists.`);
      const entry: TeamSessionAccess = {
        sessionId,
        owner: actorId(owner),
        generation: 1,
        createdAt: nowIso(),
        grants: [{ actor: actorId(owner), role: "owner", grantedAt: nowIso() }]
      };
      entries.set(sessionId, entry);
      return structuredClone(entry);
    });
  }

  async grant(sessionId: string, requester: string, actor: string, role: Exclude<TeamSessionRole, "owner">): Promise<TeamSessionAccess> {
    await this.initialize();
    return this.#mutate((entries) => {
      const entry = this.#require(sessionId, entries);
      this.#assert(entry, requester, "owner");
      const target = actorId(actor);
      const previous = entry.grants.find((grant) => grant.actor === target && !grant.revokedAt);
      if (previous) previous.revokedAt = nowIso();
      entry.grants.push({ actor: target, role, grantedAt: nowIso() });
      entry.generation += 1;
      return structuredClone(entry);
    });
  }

  async revoke(sessionId: string, requester: string, actor: string): Promise<TeamSessionAccess> {
    await this.initialize();
    return this.#mutate((entries) => {
      const entry = this.#require(sessionId, entries);
      this.#assert(entry, requester, "owner");
      const target = actorId(actor);
      if (target === entry.owner) throw new CockroachBrowserError("SESSION_OWNER_REVOKE_DENIED", "Transfer ownership before revoking the owner.");
      for (const grant of entry.grants) if (grant.actor === target && !grant.revokedAt) grant.revokedAt = nowIso();
      entry.generation += 1;
      return structuredClone(entry);
    });
  }

  async remove(sessionId: string): Promise<void> {
    await this.initialize();
    await this.#mutate((entries) => { entries.delete(sessionId); });
  }

  async get(sessionId: string): Promise<TeamSessionAccess | undefined> {
    await this.initialize();
    const entry = this.#entries.get(sessionId);
    return entry ? structuredClone(entry) : undefined;
  }

  async assert(sessionId: string, actor: string, required: TeamSessionRole): Promise<void> {
    await this.initialize();
    this.#assert(this.#require(sessionId), actor, required);
  }

  #assert(entry: TeamSessionAccess, actor: string, required: TeamSessionRole): void {
    const identity = actorId(actor);
    const grant = [...entry.grants].reverse().find((item) => item.actor === identity && !item.revokedAt);
    const rank = { viewer: 1, operator: 2, owner: 3 } as const;
    if (!grant || rank[grant.role] < rank[required]) {
      throw new CockroachBrowserError("SESSION_ACCESS_DENIED", `${identity} does not have ${required} access to ${entry.sessionId}.`);
    }
  }

  #require(sessionId: string, entries = this.#entries): TeamSessionAccess {
    const entry = entries.get(sessionId);
    if (!entry) throw new CockroachBrowserError("SESSION_ACCESS_NOT_FOUND", `No access record exists for ${sessionId}.`);
    return entry;
  }

  async #mutate<T>(operation: (entries: Map<string, TeamSessionAccess>) => T): Promise<T> {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const previous = this.#tail;
    this.#tail = previous.then(() => gate);
    await previous;
    try {
      const draft = new Map(
        [...this.#entries.entries()].map(([sessionId, entry]) => [sessionId, structuredClone(entry)] as const)
      );
      const result = operation(draft);
      const temp = `${this.path}.tmp`;
      await writeFile(temp, `${canonicalJson({ version: 1, sessions: [...draft.values()] })}\n`, { mode: 0o600 });
      await rename(temp, this.path);
      this.#entries = draft;
      return result;
    } finally {
      resolveGate();
    }
  }
}

function actorId(value: string): string {
  const actor = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(actor)) throw new CockroachBrowserError("ACTOR_ID_INVALID", "Actor IDs must be explicit and bounded.");
  return actor;
}

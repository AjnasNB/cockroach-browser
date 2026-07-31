import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, nowIso } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

export interface PersistentBrowserProfile {
  name: string;
  createdAt: string;
  updatedAt: string;
  path: string;
  bytes: number;
}

interface StoredProfileMetadata {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Owns explicit Playwright user-data directories. It never scans or imports an
 * ambient Chrome/Edge profile. Deletion is implemented as a recoverable move
 * into the runtime archive rather than a recursive erase.
 */
export class PersistentBrowserProfileStore {
  readonly root: string;
  readonly archiveRoot: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.archiveRoot = resolve(`${this.root}-archive`);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(this.archiveRoot, { recursive: true, mode: 0o700 });
  }

  async prepare(name: string): Promise<PersistentBrowserProfile> {
    await this.initialize();
    const normalized = profileName(name);
    const path = this.path(normalized);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const metadataPath = join(path, ".cockroach-profile.json");
    let metadata: StoredProfileMetadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8")) as StoredProfileMetadata;
      if (metadata.version !== 1 || metadata.name !== normalized) throw new Error("invalid profile metadata");
      metadata.updatedAt = nowIso();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CockroachBrowserError("PERSISTENT_PROFILE_INVALID", `Profile ${normalized} has invalid metadata.`);
      }
      const timestamp = nowIso();
      metadata = { version: 1, name: normalized, createdAt: timestamp, updatedAt: timestamp };
    }
    await writeFile(metadataPath, `${canonicalJson(metadata)}\n`, { mode: 0o600 });
    return { ...metadata, path, bytes: await directoryBytes(path) };
  }

  async list(): Promise<PersistentBrowserProfile[]> {
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    const profiles: PersistentBrowserProfile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const name = profileName(entry.name);
      const path = this.path(name);
      try {
        const metadata = JSON.parse(await readFile(join(path, ".cockroach-profile.json"), "utf8")) as StoredProfileMetadata;
        if (metadata.version !== 1 || metadata.name !== name) continue;
        profiles.push({ ...metadata, path, bytes: await directoryBytes(path) });
      } catch {
        // Ignore unrelated or partially created directories.
      }
    }
    return profiles.sort((left, right) => left.name.localeCompare(right.name));
  }

  async archive(name: string): Promise<{ name: string; archivedPath: string }> {
    await this.initialize();
    const normalized = profileName(name);
    const source = this.path(normalized);
    await stat(source).catch(() => {
      throw new CockroachBrowserError("PERSISTENT_PROFILE_NOT_FOUND", `Profile ${normalized} does not exist.`);
    });
    const archivedPath = join(this.archiveRoot, `${normalized}-${Date.now()}`);
    await rename(source, archivedPath);
    return { name: normalized, archivedPath };
  }

  path(name: string): string {
    return join(this.root, profileName(name));
  }
}

export function profileName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name === "." || name === "..") {
    throw new CockroachBrowserError(
      "PERSISTENT_PROFILE_NAME_INVALID",
      "Persistent profile names may contain letters, numbers, dots, underscores, and hyphens."
    );
  }
  return name;
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await directoryBytes(path);
    if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

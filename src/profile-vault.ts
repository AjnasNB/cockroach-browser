import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { BrowserContext } from "playwright-core";
import { CockroachBrowserError } from "./errors.js";

interface VaultEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
}

export class ProfileVault {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async list(): Promise<string[]> {
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".storage.enc.json"))
      .map((entry) => entry.name.slice(0, -".storage.enc.json".length))
      .sort();
  }

  async load(name: string, passphrase: string): Promise<Record<string, unknown>> {
    const path = this.#path(name);
    const envelope = JSON.parse(await readFile(path, "utf8")) as VaultEnvelope;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new CockroachBrowserError("UNSUPPORTED_PROFILE_FORMAT", "The encrypted profile format is not supported.");
    }
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const key = scryptSync(passphrase, salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new CockroachBrowserError("PROFILE_DECRYPT_FAILED", "The profile could not be decrypted.");
    } finally {
      key.fill(0);
    }
  }

  async save(name: string, storageState: unknown, passphrase: string): Promise<void> {
    assertPassphrase(passphrase);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(storageState));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: VaultEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      createdAt: new Date().toISOString()
    };
    key.fill(0);
    plaintext.fill(0);
    await atomicWrite(this.#path(name), `${JSON.stringify(envelope, null, 2)}\n`);
  }

  async saveContext(name: string, context: BrowserContext, passphrase: string): Promise<void> {
    await this.save(name, await context.storageState(), passphrase);
  }

  async importFile(name: string, sourcePath: string, passphrase: string): Promise<void> {
    const state = JSON.parse(await readFile(resolve(sourcePath), "utf8")) as unknown;
    await this.save(name, state, passphrase);
  }

  async exportFile(name: string, destinationPath: string, passphrase: string): Promise<void> {
    const state = await this.load(name, passphrase);
    await atomicWrite(resolve(destinationPath), `${JSON.stringify(state, null, 2)}\n`);
  }

  #path(name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
      throw new CockroachBrowserError("INVALID_PROFILE_NAME", "Profile names use letters, numbers, dot, underscore, and dash.");
    }
    const target = resolve(this.root, `${name}.storage.enc.json`);
    if (relative(this.root, target).startsWith("..")) {
      throw new CockroachBrowserError("PROFILE_PATH_ESCAPE", "Profile paths must remain inside the vault.");
    }
    return target;
  }
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 12) {
    throw new CockroachBrowserError("WEAK_PROFILE_PASSPHRASE", "Profile passphrases must contain at least 12 characters.");
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

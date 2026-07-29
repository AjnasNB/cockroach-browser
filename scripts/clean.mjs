import { readdir, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [resolve(root, "dist"), resolve(root, ".test-dist")];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && /^cockroach-browser-\d+\.\d+\.\d+.*\.tgz$/.test(entry.name)) {
    targets.push(resolve(root, entry.name));
  }
}

for (const target of targets) {
  const relation = relative(root, target);
  if (!relation || relation.startsWith("..") || basename(target) === basename(root)) {
    throw new Error(`Refusing to remove unsafe target: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

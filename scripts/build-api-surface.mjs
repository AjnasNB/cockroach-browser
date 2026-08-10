import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const outputPath = join(root, "docs", "compatibility", "browser-api-surface.json");
const check = process.argv.includes("--check");

const packages = [
  {
    name: "playwright-core",
    declaration: join(root, "node_modules", "playwright-core", "types", "types.d.ts"),
    reexport: "cockroach-browser/automation"
  },
  {
    name: "puppeteer-core",
    declaration: join(root, "node_modules", "puppeteer-core", "lib", "types.d.ts"),
    reexport: "cockroach-browser/puppeteer"
  }
];

const packageRows = [];
for (const descriptor of packages) {
  const packageJson = JSON.parse(await readFile(join(root, "node_modules", descriptor.name, "package.json"), "utf8"));
  const sourceText = await readFile(descriptor.declaration, "utf8");
  const source = ts.createSourceFile(descriptor.declaration, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  packageRows.push({
    package: descriptor.name,
    version: packageJson.version,
    reexport: descriptor.reexport,
    declaration: descriptor.declaration.slice(root.length + 1).replaceAll("\\", "/"),
    ...inventory(source)
  });
}

const manifest = {
  schemaVersion: 1,
  generatedFrom: "installed TypeScript declarations",
  scope: "public class, interface, function, variable, enum, and type declarations; overloads are counted but grouped by owner and name",
  warning: "Declaration members are API contracts, not independent product features or proof of runtime execution.",
  packages: packageRows
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== serialized) {
    throw new Error("browser-api-surface.json is stale. Run npm run api-surface:build.");
  }
  process.stdout.write(`Verified ${outputPath}\n`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
  process.stdout.write(`Wrote ${outputPath}\n`);
}

function inventory(source) {
  const owners = [];
  const topLevel = [];
  const declarationKinds = { classes: 0, interfaces: 0, functions: 0, variables: 0, enums: 0, typeAliases: 0 };
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      const name = statement.name?.text;
      if (!name) continue;
      if (ts.isClassDeclaration(statement)) declarationKinds.classes += 1;
      else declarationKinds.interfaces += 1;
      owners.push({
        name,
        kind: ts.isClassDeclaration(statement) ? "class" : "interface",
        members: groupMembers(statement.members)
      });
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarationKinds.functions += 1;
      addTopLevel(topLevel, "function", statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarationKinds.variables += 1;
        addTopLevel(topLevel, "variable", declaration.name.text);
      }
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      declarationKinds.enums += 1;
      addTopLevel(topLevel, "enum", statement.name.text);
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      declarationKinds.typeAliases += 1;
      addTopLevel(topLevel, "type", statement.name.text);
    }
  }
  owners.sort(byName);
  topLevel.sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  const memberNames = owners.reduce((sum, owner) => sum + owner.members.length, 0);
  const memberSignatures = owners.reduce(
    (sum, owner) => sum + owner.members.reduce((memberSum, member) => memberSum + member.signatures, 0),
    0
  );
  return {
    summary: {
      ...declarationKinds,
      owners: owners.length,
      groupedOwnerMembers: memberNames,
      ownerMemberSignatures: memberSignatures,
      topLevelDeclarations: topLevel.length
    },
    owners,
    topLevel
  };
}

function groupMembers(members) {
  const grouped = new Map();
  for (const member of members) {
    if (hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) continue;
    const kind = memberKind(member);
    if (!kind) continue;
    const name = memberName(member, kind);
    if (!name || name.startsWith("#")) continue;
    const key = `${kind}:${name}`;
    const current = grouped.get(key) ?? { name, kind, signatures: 0 };
    current.signatures += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}

function memberKind(member) {
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return "method";
  if (ts.isGetAccessorDeclaration(member)) return "getter";
  if (ts.isSetAccessorDeclaration(member)) return "setter";
  if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) return "property";
  if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) return "constructor";
  if (ts.isCallSignatureDeclaration(member)) return "call";
  if (ts.isIndexSignatureDeclaration(member)) return "index";
  return undefined;
}

function memberName(member, kind) {
  if (kind === "constructor") return "constructor";
  if (kind === "call") return "call";
  if (kind === "index") return "index";
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.getText();
  return undefined;
}

function isExported(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function addTopLevel(rows, kind, name) {
  const current = rows.find((row) => row.kind === kind && row.name === name);
  if (current) current.signatures += 1;
  else rows.push({ name, kind, signatures: 1 });
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

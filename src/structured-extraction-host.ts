import { URL } from "node:url";
import { parse, parseFragment } from "parse5";
import type {
  StructuredExtractionResult,
  StructuredExtractionSanitization,
  StructuredExtractionTruncation,
  StructuredLink,
  StructuredMetadata,
  StructuredTable
} from "./structured-extraction.js";
import {
  normalizeStructuredExtractionLimits,
  type StructuredExtractionLimits
} from "./structured-extraction-limits.js";

interface HtmlAttribute {
  name: string;
  value: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
}

interface SafeElement {
  kind: "element";
  tag: string;
  attributes: HtmlAttribute[];
  children: SafeNode[];
}

interface SafeText {
  kind: "text";
  value: string;
}

type SafeNode = SafeElement | SafeText;

interface BoundedHtmlTraversal {
  nodes: HtmlNode[];
  admitted: WeakSet<HtmlNode>;
  admittedChildren: WeakMap<HtmlNode, HtmlNode[]>;
  elementsByTag: Map<string, HtmlNode[]>;
  truncated: boolean;
}

export interface HostStructuredExtractionOptions {
  baseUrl?: string;
  documentScope: boolean;
  limits?: StructuredExtractionLimits;
}

const SAFE_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button",
  "caption", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "dialog", "div", "dl",
  "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup",
  "hr", "i", "img", "ins", "kbd", "label", "li", "main", "mark", "menu", "nav", "ol", "p", "pre", "q",
  "s", "samp", "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "time", "tr", "u", "ul", "var", "wbr"
]);
const DISCARD_WITH_CONTENTS = new Set([
  "script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet",
  "svg", "math", "canvas", "video", "audio", "source", "track", "base", "link", "meta"
]);
const VOID_TAGS = new Set(["br", "col", "hr", "img", "wbr"]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "caption", "dd", "details", "div", "dl", "dt", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol",
  "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"
]);
const MAX_DOM_DEPTH = 512;

/**
 * Parses untrusted markup in the Node.js host. The page realm supplies bytes,
 * never sanitizer decisions; replaced page globals therefore cannot widen the
 * admitted URL, element, attribute, JSON-LD, or output boundaries.
 */
export function extractStructuredFromUntrustedHtml(
  source: string,
  options: HostStructuredExtractionOptions
): StructuredExtractionResult {
  const limits = normalizeStructuredExtractionLimits(options.limits);
  const rawRoot = (options.documentScope ? parse(source) : parseFragment(source)) as unknown as HtmlNode;
  const truncated: StructuredExtractionTruncation = {
    text: false,
    html: false,
    markdown: false,
    links: false,
    metadata: false,
    jsonLd: false,
    tables: false,
    tableRows: false,
    tableColumns: false,
    domNodes: false
  };
  const rawTraversal = traverseHtmlBounded(rawRoot, limits.maxDomNodes, MAX_DOM_DEPTH);
  truncated.domNodes = rawTraversal.truncated;
  const sanitization: StructuredExtractionSanitization = {
    removedElements: rawTraversal.nodes.filter((node) => (
      node.tagName && DISCARD_WITH_CONTENTS.has(node.tagName.toLowerCase())
    )).length,
    removedAttributes: 0,
    removedUrls: 0,
    invalidJsonLd: 0
  };
  const cleanText = (value: unknown, maximum = limits.maxItemChars): string => String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
  const cleanDataText = (value: unknown, maximum = limits.maxItemChars): string => cleanText(value, maximum)
    .replace(/<[^>]{0,4096}>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

  const firstBase = options.documentScope
    ? elementsWithTag(rawTraversal, "base").map((node) => attribute(node, "href")).find(Boolean)
    : undefined;
  const baseUrl = safeBaseUrl(firstBase, options.baseUrl);
  const safeUrl = (value: unknown): string | undefined => {
    const candidate = String(value ?? "")
      .replace(/[\u0000-\u0020\u007F]/g, "")
      .slice(0, 4_096);
    if (!candidate) return undefined;
    try {
      const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
      if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
        sanitization.removedUrls += 1;
        return undefined;
      }
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && (parsed.username || parsed.password)) {
        sanitization.removedUrls += 1;
        return undefined;
      }
      const serialized = parsed.toString();
      if (serialized.length > 2_048) {
        sanitization.removedUrls += 1;
        return undefined;
      }
      return serialized;
    } catch {
      sanitization.removedUrls += 1;
      return undefined;
    }
  };

  const sanitize = (node: HtmlNode, output: SafeNode[]): { children?: SafeNode[]; descend: boolean } => {
    if (node.nodeName === "#text") {
      output.push({ kind: "text", value: node.value ?? "" });
      return { descend: false };
    }
    const tag = node.tagName?.toLowerCase();
    if (!tag) {
      return { children: output, descend: true };
    }
    if (DISCARD_WITH_CONTENTS.has(tag)) {
      return { descend: false };
    }
    if (!SAFE_TAGS.has(tag)) {
      sanitization.removedElements += 1;
      return { children: output, descend: true };
    }
    const safe: SafeElement = { kind: "element", tag, attributes: [], children: [] };
    for (const input of node.attrs ?? []) {
      const name = input.name.toLowerCase();
      let value: string | undefined;
      if (tag === "a" && name === "href") value = safeUrl(input.value);
      else if (tag === "img" && (name === "alt" || name === "title")) value = cleanText(input.value, 512);
      else if (["title", "datetime", "scope"].includes(name)) value = cleanText(input.value, 512);
      else if (name === "cite") value = safeUrl(input.value);
      else if (["colspan", "rowspan"].includes(name) && /^\d{1,3}$/.test(input.value)) value = input.value;
      else if (tag === "details" && name === "open") value = "";
      if (value !== undefined && (value.length > 0 || (tag === "details" && name === "open"))) {
        safe.attributes.push({ name, value });
      } else {
        sanitization.removedAttributes += 1;
      }
    }
    output.push(safe);
    return { children: safe.children, descend: tag !== "img" };
  };
  const safeNodes: SafeNode[] = [];
  const body = elementsWithTag(rawTraversal, "body")[0];
  const contentNodes = options.documentScope
    ? (body ? rawTraversal.admittedChildren.get(body) ?? [] : [])
    : (rawTraversal.admittedChildren.get(rawRoot) ?? []);
  const pendingSanitization: Array<{ node: HtmlNode; output: SafeNode[] }> = [];
  pushHtmlChildren(pendingSanitization, contentNodes, safeNodes);
  while (pendingSanitization.length > 0) {
    const current = pendingSanitization.pop()!;
    if (!rawTraversal.admitted.has(current.node)) {
      truncated.domNodes = true;
      continue;
    }
    const result = sanitize(current.node, current.output);
    if (result.descend) {
      pushHtmlChildren(
        pendingSanitization,
        rawTraversal.admittedChildren.get(current.node) ?? [],
        result.children ?? current.output
      );
    }
  }

  const tables = extractTables(safeNodes, limits, truncated, cleanText);
  const links: StructuredLink[] = [];
  const seenLinks = new Set<string>();
  const anchors = safeElements(safeNodes).filter((node) => node.tag === "a" && safeAttribute(node, "href"));
  for (const anchor of anchors) {
    const href = safeAttribute(anchor, "href");
    if (!href) continue;
    const text = cleanText(textFromSafe([anchor]), 512);
    const title = cleanText(safeAttribute(anchor, "title"), 512);
    const key = `${href}\u0000${text}`;
    if (seenLinks.has(key)) continue;
    if (links.length >= limits.maxLinks) {
      truncated.links = true;
      break;
    }
    seenLinks.add(key);
    links.push({ text, href, ...(title ? { title } : {}) });
  }
  if (seenLinks.size < anchors.length && links.length >= limits.maxLinks) truncated.links = true;

  const metadata: StructuredMetadata[] = [];
  const seenMetadata = new Set<string>();
  const addMetadata = (rawName: unknown, rawContent: unknown): void => {
    const name = cleanDataText(rawName, 256).toLowerCase();
    let content = cleanDataText(rawContent);
    if (!name || !content) return;
    if (/(?:^|:|_)(?:url|uri|image|logo|canonical)(?:$|:|_)/i.test(name)) {
      const admitted = safeUrl(content);
      if (!admitted) return;
      content = admitted;
    }
    const key = `${name}\u0000${content}`;
    if (seenMetadata.has(key)) return;
    if (metadata.length >= limits.maxMetadataItems) {
      truncated.metadata = true;
      return;
    }
    seenMetadata.add(key);
    metadata.push({ name, content });
  };
  if (options.documentScope) {
    const title = elementsWithTag(rawTraversal, "title")[0];
    const html = elementsWithTag(rawTraversal, "html")[0];
    addMetadata("title", title
      ? rawTextBounded(title, rawTraversal, Math.max(4_096, limits.maxItemChars * 4)).value
      : "");
    addMetadata("language", html ? attribute(html, "lang") : "");
  }
  const metas = elementsWithTag(rawTraversal, "meta").filter((node) => (
    attribute(node, "name") || attribute(node, "property") || attribute(node, "itemprop")
  ));
  for (const meta of metas) {
    addMetadata(
      attribute(meta, "name") ?? attribute(meta, "property") ?? attribute(meta, "itemprop"),
      attribute(meta, "content")
    );
  }
  if (options.documentScope) {
    const canonical = elementsWithTag(rawTraversal, "link").find((node) => (
      (attribute(node, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical") && attribute(node, "href")
    ));
    if (canonical) {
      const href = safeUrl(attribute(canonical, "href"));
      if (href) addMetadata("canonical", href);
    }
  }
  if (metadata.length >= limits.maxMetadataItems && metas.length > metadata.length) truncated.metadata = true;

  const jsonLd: unknown[] = [];
  const scripts = elementsWithTag(rawTraversal, "script").filter((node) => (
    (attribute(node, "type") ?? "").trim().toLowerCase() === "application/ld+json"
  ));
  let jsonLdChars = 0;
  const maxRawJsonLdChars = Math.max(100_000, limits.maxJsonLdChars * 4);
  for (const script of scripts) {
    if (jsonLd.length >= limits.maxJsonLdItems) {
      truncated.jsonLd = true;
      break;
    }
    const rawText = rawTextBounded(script, rawTraversal, maxRawJsonLdChars + 1);
    const raw = rawText.value.trim();
    if (!raw) continue;
    if (rawText.truncated || raw.length > maxRawJsonLdChars) {
      sanitization.invalidJsonLd += 1;
      truncated.jsonLd = true;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (jsonLd.length >= limits.maxJsonLdItems) {
          truncated.jsonLd = true;
          break;
        }
        const cleaned = sanitizeJson(value, "", 0, safeUrl, cleanDataText, truncated);
        if (cleaned === undefined) continue;
        const serialized = JSON.stringify(cleaned);
        if (jsonLdChars + serialized.length > limits.maxJsonLdChars) {
          truncated.jsonLd = true;
          break;
        }
        jsonLd.push(cleaned);
        jsonLdChars += serialized.length;
      }
    } catch {
      sanitization.invalidJsonLd += 1;
    }
  }
  if (scripts.length > limits.maxJsonLdItems) truncated.jsonLd = true;

  const bounded = (value: string, maximum: number, key: "text" | "html" | "markdown"): string => {
    if (value.length <= maximum) return value;
    truncated[key] = true;
    return value.slice(0, maximum);
  };
  const rawOutputText = cleanText(textFromSafe(safeNodes), 1_000_000);
  const rawHtml = htmlFromSafe(safeNodes);
  const rawMarkdown = markdownFromSafe(safeNodes, cleanText)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text: bounded(rawOutputText, limits.maxTextChars, "text"),
    html: bounded(rawHtml, limits.maxHtmlChars, "html"),
    markdown: bounded(rawMarkdown, limits.maxMarkdownChars, "markdown"),
    links,
    metadata,
    jsonLd,
    tables,
    truncated,
    sanitization
  };
}

function safeBaseUrl(firstBase: string | undefined, fallback: string | undefined): string | undefined {
  for (const candidate of [firstBase, fallback]) {
    if (!candidate) continue;
    try {
      const parsed = fallback && candidate === firstBase ? new URL(candidate, fallback) : new URL(candidate);
      if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.toString();
    } catch {
      // Try the next host-supplied base.
    }
  }
  return undefined;
}

function traverseHtmlBounded(root: HtmlNode, maxNodes: number, maxDepth: number): BoundedHtmlTraversal {
  const nodes: HtmlNode[] = [];
  const admitted = new WeakSet<HtmlNode>();
  const admittedChildren = new WeakMap<HtmlNode, HtmlNode[]>();
  const elementsByTag = new Map<string, HtmlNode[]>();
  const pending: Array<{
    node: HtmlNode;
    depth: number;
    parent?: HtmlNode;
    entered: boolean;
    nextChildIndex: number;
  }> = [{ node: root, depth: 0, entered: false, nextChildIndex: 0 }];
  let truncated = false;
  while (pending.length > 0) {
    const current = pending[pending.length - 1]!;
    if (!current.entered) {
      if (nodes.length >= maxNodes) {
        truncated = true;
        break;
      }
      if (current.depth > maxDepth) {
        truncated = true;
        pending.pop();
        continue;
      }
      current.entered = true;
      nodes.push(current.node);
      admitted.add(current.node);
      admittedChildren.set(current.node, []);
      if (current.parent) admittedChildren.get(current.parent)!.push(current.node);
      const tag = current.node.tagName?.toLowerCase();
      if (tag) {
        const indexed = elementsByTag.get(tag) ?? [];
        indexed.push(current.node);
        elementsByTag.set(tag, indexed);
      }
    }
    const children = current.node.childNodes ?? [];
    if (current.nextChildIndex >= children.length) {
      pending.pop();
      continue;
    }
    if (current.depth === maxDepth) {
      truncated = true;
      pending.pop();
      continue;
    }
    const child = children[current.nextChildIndex++]!;
    pending.push({
      node: child,
      depth: current.depth + 1,
      parent: current.node,
      entered: false,
      nextChildIndex: 0
    });
  }
  return { nodes, admitted, admittedChildren, elementsByTag, truncated };
}

function elementsWithTag(traversal: BoundedHtmlTraversal, tag: string): HtmlNode[] {
  return traversal.elementsByTag.get(tag) ?? [];
}

function pushHtmlChildren(
  pending: Array<{ node: HtmlNode; output: SafeNode[] }>,
  children: readonly HtmlNode[],
  output: SafeNode[]
): void {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push({ node: children[index]!, output });
  }
}

function attribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function rawTextBounded(
  root: HtmlNode,
  traversal: BoundedHtmlTraversal,
  maximum: number
): { value: string; truncated: boolean } {
  const parts: string[] = [];
  const pending = [root];
  let length = 0;
  let truncated = false;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!traversal.admitted.has(node)) {
      truncated = true;
      continue;
    }
    if (node.nodeName === "#text") {
      const value = node.value ?? "";
      const remaining = Math.max(0, maximum - length);
      if (value.length > remaining) {
        if (remaining > 0) parts.push(value.slice(0, remaining));
        truncated = true;
        break;
      }
      parts.push(value);
      length += value.length;
      continue;
    }
    const children = traversal.admittedChildren.get(node) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
  return { value: parts.join(""), truncated };
}

function safeElements(nodes: SafeNode[]): SafeElement[] {
  const found: SafeElement[] = [];
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === "text") continue;
    found.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push(node.children[index]!);
  }
  return found;
}

function safeAttribute(node: SafeElement, name: string): string | undefined {
  return node.attributes.find((entry) => entry.name === name)?.value;
}

function textFromSafe(nodes: SafeNode[]): string {
  const parts: string[] = [];
  const pending: Array<{ node: SafeNode } | { text: string }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) pending.push({ node: nodes[index]! });
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ("text" in current) {
      parts.push(current.text);
      continue;
    }
    const node = current.node;
    if (node.kind === "text") {
      parts.push(node.value);
      continue;
    }
    if (node.tag === "br") {
      parts.push("\n");
      continue;
    }
    if (BLOCK_TAGS.has(node.tag)) pending.push({ text: "\n" });
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index]! });
    }
  }
  return parts.join("");
}

function htmlFromSafe(nodes: SafeNode[]): string {
  const parts: string[] = [];
  const pending: Array<{ node: SafeNode } | { text: string }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) pending.push({ node: nodes[index]! });
  while (pending.length > 0) {
    const current = pending.pop()!;
    if ("text" in current) {
      parts.push(current.text);
      continue;
    }
    const node = current.node;
    if (node.kind === "text") {
      parts.push(escapeHtml(node.value));
      continue;
    }
    const attrs = node.attributes.map(({ name, value }) => (
      value ? ` ${name}="${escapeAttribute(value)}"` : ` ${name}`
    )).join("");
    parts.push(`<${node.tag}${attrs}>`);
    if (VOID_TAGS.has(node.tag)) continue;
    pending.push({ text: `</${node.tag}>` });
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index]! });
    }
  }
  return parts.join("");
}

function markdownFromSafe(
  nodes: SafeNode[],
  cleanText: (value: unknown, maximum?: number) => string
): string {
  const rendered = new WeakMap<SafeNode, string>();
  const pending: Array<{ node: SafeNode; listDepth: number; expanded: boolean }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    pending.push({ node: nodes[index]!, listDepth: 0, expanded: false });
  }
  while (pending.length > 0) {
    const current = pending.pop()!;
    const node = current.node;
    if (!current.expanded && node.kind === "element") {
      pending.push({ ...current, expanded: true });
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        const childDepth = (node.tag === "ul" || node.tag === "ol")
          && child.kind === "element"
          && child.tag === "li"
          ? current.listDepth + 1
          : current.listDepth;
        pending.push({ node: child, listDepth: childDepth, expanded: false });
      }
      continue;
    }
    if (node.kind === "text") {
      rendered.set(node, markdownEscape(node.value));
      continue;
    }
    const children = node.children.map((child) => rendered.get(child) ?? "").join("");
    let output: string;
    if (node.tag === "br") output = "\n";
    else if (/^h[1-6]$/.test(node.tag)) output = `${"#".repeat(Number(node.tag[1]))} ${markdownEscape(cleanText(textFromSafe(node.children)))}\n\n`;
    else if (node.tag === "p" || ["article", "aside", "div", "figcaption", "footer", "header", "main", "nav", "section"].includes(node.tag)) {
      output = `${children.trim()}\n\n`;
    } else if (node.tag === "blockquote") output = `${cleanText(textFromSafe(node.children)).split("\n").map((line) => `> ${markdownEscape(line)}`).join("\n")}\n\n`;
    else if (node.tag === "strong" || node.tag === "b") output = `**${children}**`;
    else if (node.tag === "em" || node.tag === "i") output = `_${children}_`;
    else if (node.tag === "del" || node.tag === "s") output = `~~${children}~~`;
    else if (node.tag === "code") output = `\`${cleanText(textFromSafe(node.children))}\``;
    else if (node.tag === "pre") {
      const value = textFromSafe(node.children).replace(/\s+$/g, "");
      const runs = value.match(/`+/g) ?? [];
      const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
      output = `${fence}\n${value}\n${fence}\n\n`;
    } else if (node.tag === "a") {
      const href = safeAttribute(node, "href");
      const label = children.trim() || markdownEscape(href ?? "");
      output = href ? `[${label}](${href})` : label;
    } else if (node.tag === "img") {
      const alt = cleanText(safeAttribute(node, "alt"), 512);
      output = alt ? `[Image: ${markdownEscape(alt)}]` : "";
    } else if (node.tag === "table") output = `${markdownTable(node, cleanText)}\n\n`;
    else if (node.tag === "ul" || node.tag === "ol") {
      const ordered = node.tag === "ol";
      output = `${node.children.filter((child): child is SafeElement => child.kind === "element" && child.tag === "li")
        .map((child, index) => `${"  ".repeat(current.listDepth)}${ordered ? `${index + 1}.` : "-"} ${(rendered.get(child) ?? "").trim()}`)
        .join("\n")}\n\n`;
    } else if (node.tag === "hr") output = "---\n\n";
    else output = children;
    rendered.set(node, output);
  }
  return nodes.map((node) => rendered.get(node) ?? "").join("");
}

function extractTables(
  nodes: SafeNode[],
  limits: ReturnType<typeof normalizeStructuredExtractionLimits>,
  truncated: StructuredExtractionTruncation,
  cleanText: (value: unknown, maximum?: number) => string
): StructuredTable[] {
  const candidates = safeElements(nodes).filter((node) => node.tag === "table");
  if (candidates.length > limits.maxTables) truncated.tables = true;
  return candidates.slice(0, limits.maxTables).map((table) => tableFromSafe(table, limits, truncated, cleanText));
}

function tableFromSafe(
  table: SafeElement,
  limits: ReturnType<typeof normalizeStructuredExtractionLimits>,
  truncated: StructuredExtractionTruncation,
  cleanText: (value: unknown, maximum?: number) => string
): StructuredTable {
  const rows = safeElements(table.children).filter((node) => node.tag === "tr");
  const headers: string[] = [];
  const outputRows: string[][] = [];
  let headerCount = 0;
  for (const row of rows) {
    const cells = row.children.filter((child): child is SafeElement => (
      child.kind === "element" && (child.tag === "td" || child.tag === "th")
    ));
    if (cells.length > limits.maxTableColumns) truncated.tableColumns = true;
    const values = cells.slice(0, limits.maxTableColumns).map((cell) => cleanText(textFromSafe(cell.children)));
    const isHeader = cells.length > 0 && cells.every((cell) => cell.tag === "th") && headers.length === 0;
    if (isHeader) {
      headers.push(...values);
      headerCount += 1;
      continue;
    }
    if (outputRows.length >= limits.maxTableRows) {
      truncated.tableRows = true;
      continue;
    }
    outputRows.push(values);
  }
  if (rows.length > limits.maxTableRows + headerCount) truncated.tableRows = true;
  const caption = safeElements(table.children).find((node) => node.tag === "caption");
  const captionText = caption ? cleanText(textFromSafe(caption.children), 512) : "";
  return { ...(captionText ? { caption: captionText } : {}), headers, rows: outputRows };
}

function markdownTable(
  table: SafeElement,
  cleanText: (value: unknown, maximum?: number) => string
): string {
  const localTruncation = {} as StructuredExtractionTruncation;
  const extracted = tableFromSafe(table, normalizeStructuredExtractionLimits(undefined), localTruncation, cleanText);
  const columns = Math.max(extracted.headers.length, ...extracted.rows.map((row) => row.length), 0);
  if (columns === 0) return "";
  const headers = extracted.headers.length > 0
    ? extracted.headers
    : Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
  const line = (row: string[]): string => `| ${Array.from({ length: columns }, (_, index) => (
    markdownEscape(row[index] ?? "")
  ).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...extracted.rows.map(line)].join("\n");
}

function sanitizeJson(
  value: unknown,
  key: string,
  depth: number,
  safeUrl: (value: unknown) => string | undefined,
  cleanDataText: (value: unknown, maximum?: number) => string,
  truncated: StructuredExtractionTruncation
): unknown {
  if (depth > 8) {
    truncated.jsonLd = true;
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    if (/^(?:@id|@context|sameas|image|logo)$/i.test(key) || /(?:url|uri)$/i.test(key)) return safeUrl(value);
    return cleanDataText(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 128) truncated.jsonLd = true;
    return value.slice(0, 128).map((entry) => sanitizeJson(entry, key, depth + 1, safeUrl, cleanDataText, truncated))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) truncated.jsonLd = true;
  const output: Record<string, unknown> = {};
  for (const [rawKey, entryValue] of entries.slice(0, 128)) {
    const cleanKey = cleanDataText(rawKey, 256);
    if (!cleanKey || ["__proto__", "prototype", "constructor"].includes(cleanKey.toLowerCase())) continue;
    const cleanValue = sanitizeJson(entryValue, cleanKey, depth + 1, safeUrl, cleanDataText, truncated);
    if (cleanValue !== undefined) output[cleanKey] = cleanValue;
  }
  return output;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function markdownEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_{}\[\]()<>])/g, "\\$1");
}

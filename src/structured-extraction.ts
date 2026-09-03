import type { Locator, Page } from "playwright-core";
import { CockroachBrowserError } from "./errors.js";
import { extractStructuredFromUntrustedHtml } from "./structured-extraction-host.js";
export {
  normalizeStructuredExtractionLimits,
  STRUCTURED_EXTRACTION_LIMIT_SPECS,
  type NormalizedStructuredExtractionLimits,
  type StructuredExtractionLimitName,
  type StructuredExtractionLimits
} from "./structured-extraction-limits.js";
import type { StructuredExtractionLimits } from "./structured-extraction-limits.js";

export interface StructuredLink {
  text: string;
  href: string;
  title?: string;
}

export interface StructuredMetadata {
  name: string;
  content: string;
}

export interface StructuredTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface StructuredExtractionTruncation {
  text: boolean;
  html: boolean;
  markdown: boolean;
  links: boolean;
  metadata: boolean;
  jsonLd: boolean;
  tables: boolean;
  tableRows: boolean;
  tableColumns: boolean;
  domNodes: boolean;
}

export interface StructuredExtractionSanitization {
  removedElements: number;
  removedAttributes: number;
  removedUrls: number;
  invalidJsonLd: number;
}

export interface StructuredExtractionResult {
  text: string;
  html: string;
  markdown: string;
  links: StructuredLink[];
  metadata: StructuredMetadata[];
  jsonLd: unknown[];
  tables: StructuredTable[];
  truncated: StructuredExtractionTruncation;
  sanitization: StructuredExtractionSanitization;
}

/**
 * Treats the page serialization as hostile input and makes every admission
 * decision in the Node.js host. Page-owned JavaScript globals are never used
 * as a sanitizer or URL-policy authority.
 */
export async function extractStructuredFromPage(
  page: Page,
  limits?: StructuredExtractionLimits
): Promise<StructuredExtractionResult> {
  const captureLimit = rawCaptureLimit(limits);
  const capture = await page.evaluate((maximum) => {
    const raw = document.documentElement?.outerHTML;
    if (typeof raw !== "string") return { source: "", truncated: false, invalid: true };
    const length = raw.length < maximum ? raw.length : maximum;
    let source = "";
    for (let index = 0; index < length; index += 1) source += raw[index];
    return { source, truncated: raw.length > maximum, invalid: false };
  }, captureLimit) as unknown;
  const source = assertedSourceCapture(capture);
  const result = extractStructuredFromUntrustedHtml(source.source, {
    baseUrl: boundedHostString(page.url(), 4_096),
    documentScope: true,
    ...(limits ? { limits } : {})
  });
  if (source.truncated) result.truncated.domNodes = true;
  return limits?.maxTotalChars === undefined
    ? result
    : boundStructuredExtractionResult(result, limits.maxTotalChars);
}

/**
 * The selected element may lie about its serialized content or base URL; both
 * values remain untrusted bytes until the host parser and sanitizer accept
 * them. This preserves selector scoping without trusting page-realm globals.
 */
export async function extractStructuredFromLocator(
  locator: Locator,
  limits?: StructuredExtractionLimits
): Promise<StructuredExtractionResult> {
  const captureLimit = rawCaptureLimit(limits);
  const capture = await locator.evaluate((element, maximum) => {
    const raw = element.innerHTML;
    const rawBase = element.ownerDocument.baseURI;
    if (typeof raw !== "string") return { source: "", baseUrl: "", truncated: false, invalid: true };
    const length = raw.length < maximum ? raw.length : maximum;
    let source = "";
    for (let index = 0; index < length; index += 1) source += raw[index];
    let baseUrl = "";
    if (typeof rawBase === "string") {
      const baseLength = rawBase.length < 4_096 ? rawBase.length : 4_096;
      for (let index = 0; index < baseLength; index += 1) baseUrl += rawBase[index];
    }
    return { source, baseUrl, truncated: raw.length > maximum, invalid: false };
  }, captureLimit) as unknown;
  const source = assertedSourceCapture(capture);
  const result = extractStructuredFromUntrustedHtml(source.source, {
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
    documentScope: false,
    ...(limits ? { limits } : {})
  });
  if (source.truncated) result.truncated.domNodes = true;
  return limits?.maxTotalChars === undefined
    ? result
    : boundStructuredExtractionResult(result, limits.maxTotalChars);
}

interface SourceCapture {
  source: string;
  baseUrl?: string;
  truncated: boolean;
}

function assertedSourceCapture(value: unknown): SourceCapture {
  if (
    !value
    || typeof value !== "object"
    || typeof (value as { source?: unknown }).source !== "string"
    || typeof (value as { truncated?: unknown }).truncated !== "boolean"
    || (value as { invalid?: unknown }).invalid === true
    || ((value as { baseUrl?: unknown }).baseUrl !== undefined && typeof (value as { baseUrl?: unknown }).baseUrl !== "string")
  ) {
    throw new CockroachBrowserError(
      "STRUCTURED_EXTRACTION_SOURCE_INVALID",
      "The selected page target did not return a bounded serializable HTML source."
    );
  }
  return value as SourceCapture;
}

function rawCaptureLimit(limits: StructuredExtractionLimits | undefined): number {
  const requested = limits?.maxTotalChars;
  const total = Number.isSafeInteger(requested) && requested! >= 0
    ? Math.min(requested!, 2_000_000)
    : 2_000_000;
  return Math.min(8_000_000, Math.max(100_000, total * 4));
}

function boundedHostString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

/** Counts bounded data content rather than fixed result-envelope property names. */
export function structuredExtractionContentChars(result: StructuredExtractionResult): number {
  return result.text.length
    + result.html.length
    + result.markdown.length
    + result.links.reduce((sum, item) => sum + serializedItemChars(item), 0)
    + result.metadata.reduce((sum, item) => sum + serializedItemChars(item), 0)
    + result.jsonLd.reduce<number>((sum, item) => sum + serializedItemChars(item), 0)
    + result.tables.reduce((sum, item) => sum + serializedItemChars(item), 0);
}

/**
 * Applies one aggregate ceiling after host-side extraction. Categories share
 * the available budget fairly, so one verbose representation cannot silently
 * consume the allowance intended for every other representation.
 */
export function boundStructuredExtractionResult(
  result: StructuredExtractionResult,
  maxTotalChars: number
): StructuredExtractionResult {
  const ceiling = Number.isFinite(maxTotalChars)
    ? Math.max(0, Math.min(2_000_000, Math.floor(maxTotalChars)))
    : 0;
  const output = structuredClone(result);
  const costs = [
    output.text.length,
    output.html.length,
    output.markdown.length,
    output.links.reduce((sum, item) => sum + serializedItemChars(item), 0),
    output.metadata.reduce((sum, item) => sum + serializedItemChars(item), 0),
    output.jsonLd.reduce<number>((sum, item) => sum + serializedItemChars(item), 0),
    output.tables.reduce((sum, item) => sum + serializedItemChars(item), 0)
  ];
  const allocations = fairAllocations(costs, ceiling);
  const takeString = (
    value: string,
    allocation: number,
    field: "text" | "html" | "markdown"
  ): string => {
    if (value.length <= allocation) return value;
    output.truncated[field] = true;
    return value.slice(0, allocation);
  };
  const takeItems = <T>(items: T[], allocation: number, field: "links" | "metadata" | "jsonLd" | "tables"): T[] => {
    const accepted: T[] = [];
    let used = 0;
    for (const item of items) {
      const itemChars = serializedItemChars(item);
      if (used + itemChars > allocation) {
        output.truncated[field] = true;
        continue;
      }
      accepted.push(item);
      used += itemChars;
    }
    return accepted;
  };

  output.text = takeString(output.text, allocations[0]!, "text");
  output.html = takeString(output.html, allocations[1]!, "html");
  output.markdown = takeString(output.markdown, allocations[2]!, "markdown");
  output.links = takeItems(output.links, allocations[3]!, "links");
  output.metadata = takeItems(output.metadata, allocations[4]!, "metadata");
  output.jsonLd = takeItems(output.jsonLd, allocations[5]!, "jsonLd");
  output.tables = takeItems(output.tables, allocations[6]!, "tables");
  return output;
}

function serializedItemChars(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function fairAllocations(costs: readonly number[], total: number): number[] {
  const allocations = costs.map(() => 0);
  let remaining = total;
  let pending = costs.map((_, index) => index).filter((index) => costs[index]! > 0);
  while (remaining > 0 && pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const satisfied = pending.filter((index) => costs[index]! <= share);
    if (satisfied.length > 0) {
      for (const index of satisfied) {
        allocations[index] = costs[index]!;
        remaining -= costs[index]!;
      }
      const satisfiedSet = new Set(satisfied);
      pending = pending.filter((index) => !satisfiedSet.has(index));
      continue;
    }
    for (const index of pending) {
      const allocation = Math.min(costs[index]!, share);
      allocations[index] = allocation;
      remaining -= allocation;
    }
    for (const index of pending) {
      if (remaining === 0) break;
      if (allocations[index]! < costs[index]!) {
        allocations[index]! += 1;
        remaining -= 1;
      }
    }
    break;
  }
  return allocations;
}

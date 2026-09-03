import { CockroachBrowserError } from "./errors.js";

export interface StructuredExtractionLimits {
  /** Aggregate extracted content ceiling. Structural object keys are excluded. */
  maxTotalChars?: number;
  maxTextChars?: number;
  maxHtmlChars?: number;
  maxMarkdownChars?: number;
  maxLinks?: number;
  maxMetadataItems?: number;
  maxJsonLdItems?: number;
  maxJsonLdChars?: number;
  maxTables?: number;
  maxTableRows?: number;
  maxTableColumns?: number;
  maxItemChars?: number;
  maxDomNodes?: number;
}

export type StructuredExtractionLimitName = keyof StructuredExtractionLimits;

/**
 * One canonical limit registry drives runtime validation, MCP validation, and
 * schema parity tests. `maxTotalChars` has a session-specific default and is
 * therefore the only entry without a static fallback.
 */
export const STRUCTURED_EXTRACTION_LIMIT_SPECS = Object.freeze({
  maxTotalChars: { maximum: 2_000_000 },
  maxTextChars: { maximum: 1_000_000, fallback: 50_000 },
  maxHtmlChars: { maximum: 1_000_000, fallback: 100_000 },
  maxMarkdownChars: { maximum: 1_000_000, fallback: 50_000 },
  maxLinks: { maximum: 2_000, fallback: 200 },
  maxMetadataItems: { maximum: 256, fallback: 64 },
  maxJsonLdItems: { maximum: 256, fallback: 32 },
  maxJsonLdChars: { maximum: 1_000_000, fallback: 50_000 },
  maxTables: { maximum: 256, fallback: 32 },
  maxTableRows: { maximum: 2_000, fallback: 100 },
  maxTableColumns: { maximum: 256, fallback: 30 },
  maxItemChars: { maximum: 16_384, fallback: 2_000 },
  maxDomNodes: { maximum: 200_000, fallback: 50_000 }
} satisfies Record<StructuredExtractionLimitName, { maximum: number; fallback?: number }>);

export type NormalizedStructuredExtractionLimits = Required<StructuredExtractionLimits>;

export function normalizeStructuredExtractionLimits(
  input: unknown,
  sessionCharCeiling = STRUCTURED_EXTRACTION_LIMIT_SPECS.maxTotalChars.maximum
): NormalizedStructuredExtractionLimits {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) {
    throw invalidLimit("Structured extraction limits must be an object.");
  }
  const supplied = (input ?? {}) as Record<string, unknown>;
  const known = new Set(Object.keys(STRUCTURED_EXTRACTION_LIMIT_SPECS));
  for (const key of Object.keys(supplied)) {
    if (!known.has(key)) throw invalidLimit(`Unknown structured extraction limit: ${key}.`);
  }
  const ceiling = boundedSessionCeiling(sessionCharCeiling);
  const value = (name: StructuredExtractionLimitName): number => {
    const spec = STRUCTURED_EXTRACTION_LIMIT_SPECS[name];
    const candidate = supplied[name];
    const fallback = "fallback" in spec ? spec.fallback : ceiling;
    if (candidate === undefined) return fallback;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0 || (candidate as number) > spec.maximum) {
      throw invalidLimit(`${name} must be an integer between 0 and ${spec.maximum}.`);
    }
    return candidate as number;
  };
  const maxTotalChars = Math.min(value("maxTotalChars"), ceiling);
  return {
    maxTotalChars,
    maxTextChars: Math.min(value("maxTextChars"), maxTotalChars),
    maxHtmlChars: Math.min(value("maxHtmlChars"), maxTotalChars),
    maxMarkdownChars: Math.min(value("maxMarkdownChars"), maxTotalChars),
    maxLinks: value("maxLinks"),
    maxMetadataItems: value("maxMetadataItems"),
    maxJsonLdItems: value("maxJsonLdItems"),
    maxJsonLdChars: Math.min(value("maxJsonLdChars"), maxTotalChars),
    maxTables: value("maxTables"),
    maxTableRows: value("maxTableRows"),
    maxTableColumns: value("maxTableColumns"),
    maxItemChars: Math.min(value("maxItemChars"), maxTotalChars),
    maxDomNodes: value("maxDomNodes")
  };
}

function boundedSessionCeiling(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidLimit("The session structured extraction ceiling must be a non-negative safe integer.");
  }
  return Math.min(value, STRUCTURED_EXTRACTION_LIMIT_SPECS.maxTotalChars.maximum);
}

function invalidLimit(message: string): CockroachBrowserError {
  return new CockroachBrowserError("STRUCTURED_EXTRACTION_LIMIT_INVALID", message);
}

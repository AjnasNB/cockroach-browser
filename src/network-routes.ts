import type {
  NetworkResourceType,
  NetworkRouteInput,
  NetworkRouteSummary
} from "./contracts.js";
import { sha256 } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const RESOURCE_TYPES = new Set<NetworkResourceType>([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "eventsource",
  "websocket",
  "manifest",
  "other"
]);

export interface CompiledNetworkRoute {
  summary: NetworkRouteSummary;
  body: Buffer;
  pathMatcher: RegExp;
}

export function compileNetworkRoute(
  input: NetworkRouteInput,
  id: string,
  maxBodyBytes: number
): CompiledNetworkRoute {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new CockroachBrowserError("NETWORK_ROUTE_ID_INVALID", "Network route IDs must be 1 to 128 safe characters.");
  }
  let originUrl: URL;
  try {
    originUrl = new URL(input.origin);
  } catch {
    throw new CockroachBrowserError("NETWORK_ROUTE_ORIGIN_INVALID", "A network route requires an absolute origin.");
  }
  if (
    !["http:", "https:"].includes(originUrl.protocol)
    || originUrl.username
    || originUrl.password
    || originUrl.hostname.includes("*")
    || originUrl.pathname !== "/"
    || originUrl.search
    || originUrl.hash
  ) {
    throw new CockroachBrowserError(
      "NETWORK_ROUTE_ORIGIN_INVALID",
      "Network route origins must be credential-free HTTP(S) origins without a path, query, or fragment."
    );
  }
  if (
    !input.pathPattern.startsWith("/")
    || input.pathPattern.length > 512
    || /[\u0000-\u001f\u007f]/.test(input.pathPattern)
  ) {
    throw new CockroachBrowserError(
      "NETWORK_ROUTE_PATTERN_INVALID",
      "Route path patterns must start with /, contain no control characters, and be at most 512 characters."
    );
  }
  const methods = [...new Set((input.methods ?? ["GET"]).map((entry) => entry.toUpperCase()))];
  if (methods.length === 0 || methods.length > METHODS.size || methods.some((entry) => !METHODS.has(entry))) {
    throw new CockroachBrowserError(
      "NETWORK_ROUTE_METHOD_INVALID",
      "Route methods must be a non-empty subset of GET, HEAD, POST, PUT, PATCH, DELETE, and OPTIONS."
    );
  }
  const resourceTypes = [...new Set(input.resourceTypes ?? [])];
  if (
    resourceTypes.length > RESOURCE_TYPES.size
    || resourceTypes.some((entry) => !RESOURCE_TYPES.has(entry))
  ) {
    throw new CockroachBrowserError("NETWORK_ROUTE_RESOURCE_INVALID", "A route contains an unknown resource type.");
  }

  let body = Buffer.alloc(0);
  let status: number | undefined;
  let contentType: string | undefined;
  if (input.response.action === "fulfill") {
    status = input.response.status ?? 200;
    if (!Number.isSafeInteger(status) || status < 200 || status > 599) {
      throw new CockroachBrowserError("NETWORK_ROUTE_STATUS_INVALID", "Fulfilled response status must be 200 to 599.");
    }
    contentType = input.response.contentType ?? "text/plain; charset=utf-8";
    if (!contentType || contentType.length > 200 || /[\r\n\u0000]/.test(contentType)) {
      throw new CockroachBrowserError(
        "NETWORK_ROUTE_CONTENT_TYPE_INVALID",
        "Fulfilled response content type must be one line and at most 200 characters."
      );
    }
    body = Buffer.from(input.response.body ?? "", "utf8");
    if (body.byteLength > maxBodyBytes) {
      throw new CockroachBrowserError(
        "NETWORK_ROUTE_BODY_EXCEEDED",
        `Fulfilled response body exceeds the ${maxBodyBytes}-byte per-rule ceiling.`
      );
    }
  }

  const summary: NetworkRouteSummary = {
    id,
    origin: originUrl.origin,
    pathPattern: input.pathPattern,
    methods,
    resourceTypes,
    response: {
      action: input.response.action,
      ...(status !== undefined ? { status } : {}),
      ...(contentType !== undefined ? { contentType } : {}),
      bodyBytes: body.byteLength,
      ...(body.byteLength > 0 ? { bodyDigest: sha256(body.toString("base64")) } : {})
    }
  };
  return {
    summary,
    body,
    pathMatcher: globToRegExp(input.pathPattern)
  };
}

export function networkRouteMatches(
  route: CompiledNetworkRoute,
  input: { url: string; method: string; resourceType: string }
): boolean {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return false;
  }
  return (
    url.origin === route.summary.origin
    && route.summary.methods.includes(input.method.toUpperCase())
    && (
      route.summary.resourceTypes.length === 0
      || route.summary.resourceTypes.includes(input.resourceType as NetworkResourceType)
    )
    && route.pathMatcher.test(url.pathname)
  );
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

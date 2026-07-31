import type { Page } from "playwright-core";
import type { ChallengeReport } from "./contracts.js";
import { CockroachBrowserError, errorMessage } from "./errors.js";

export type ChallengeResolutionStatus = "resolved" | "pending" | "declined";

export interface ChallengeResolutionRequest {
  sessionId: string;
  origin: string;
  purpose: string;
  report: ChallengeReport;
  requestedAt: string;
  deadlineAt: string;
}

export interface ChallengeResolutionResult {
  status: ChallengeResolutionStatus;
  /** Opaque operator or workflow reference. Never use this field for a secret. */
  reference?: string;
  reason?: string;
}

/**
 * A host-owned handoff surface for an authorized operator workflow.
 *
 * The resolver receives no Playwright Page, cookies, storage, credentials, or
 * browser-control primitives. Claiming `resolved` is not trusted on its own;
 * BrowserRuntime independently re-detects the challenge before resuming.
 */
export interface AuthorizedChallengeResolver {
  resolve(
    request: Readonly<ChallengeResolutionRequest>,
    signal: AbortSignal
  ): Promise<ChallengeResolutionResult>;
}

const SIGNALS = [
  { kind: "captcha" as const, provider: "reCAPTCHA", selector: 'iframe[src*="recaptcha"], .g-recaptcha', text: "recaptcha" },
  { kind: "captcha" as const, provider: "hCaptcha", selector: 'iframe[src*="hcaptcha"], .h-captcha', text: "hcaptcha" },
  { kind: "captcha" as const, provider: "Turnstile", selector: 'iframe[src*="challenges.cloudflare.com"], .cf-turnstile', text: "verify you are human" },
  { kind: "access-challenge" as const, provider: "Cloudflare", selector: "#challenge-running, #cf-challenge-running", text: "checking your browser" },
  { kind: "login" as const, selector: 'input[type="password"]', text: "sign in" },
  { kind: "consent" as const, selector: '[aria-label*="cookie" i], [id*="consent" i]', text: "cookie preferences" }
];

export async function detectChallenge(page: Page): Promise<ChallengeReport> {
  const evidence: string[] = [];
  for (const signal of SIGNALS) {
    let selectorFound = false;
    try {
      selectorFound = (await page.locator(signal.selector).count()) > 0;
    } catch {
      selectorFound = false;
    }
    let textFound = false;
    try {
      textFound = (await page.getByText(signal.text, { exact: false }).count()) > 0;
    } catch {
      textFound = false;
    }
    if (selectorFound || textFound) {
      if (selectorFound) evidence.push(`selector:${signal.selector}`);
      if (textFound) evidence.push(`text:${signal.text}`);
      const title = await safeTitle(page);
      return {
        detected: true,
        kind: signal.kind,
        ...(signal.provider ? { provider: signal.provider } : {}),
        ...(title ? { title } : {}),
        evidence,
        requiresHuman: signal.kind === "captcha" || signal.kind === "access-challenge" || signal.kind === "login"
      };
    }
  }
  return { detected: false, evidence: [], requiresHuman: false };
}

export async function requestAuthorizedChallengeResolution(
  resolver: AuthorizedChallengeResolver,
  request: ChallengeResolutionRequest,
  timeoutMs: number
): Promise<ChallengeResolutionResult> {
  if (!request.report.detected) {
    throw new CockroachBrowserError(
      "CHALLENGE_NOT_ACTIVE",
      "An authorized challenge resolver may be called only while a challenge is active."
    );
  }
  const boundedTimeout = Math.max(1_000, Math.min(timeoutMs, 120_000));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CockroachBrowserError(
        "CHALLENGE_RESOLVER_TIMEOUT",
        `The authorized challenge resolver did not respond within ${boundedTimeout} ms.`
      ));
    }, boundedTimeout);
  });

  try {
    const result = await Promise.race([
      resolver.resolve(structuredClone(request), controller.signal),
      timeout
    ]);
    return normalizeResolutionResult(result);
  } catch (error) {
    if (error instanceof CockroachBrowserError) throw error;
    throw new CockroachBrowserError(
      "CHALLENGE_RESOLVER_FAILED",
      `The authorized challenge resolver failed: ${errorMessage(error)}`
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeResolutionResult(result: ChallengeResolutionResult): ChallengeResolutionResult {
  if (!result || !["resolved", "pending", "declined"].includes(result.status)) {
    throw new CockroachBrowserError(
      "CHALLENGE_RESOLVER_RESULT_INVALID",
      "The authorized challenge resolver returned an invalid status."
    );
  }
  const reference = normalizeBoundedText(result.reference, 256, "CHALLENGE_RESOLVER_REFERENCE_INVALID");
  const reason = normalizeBoundedText(result.reason, 500, "CHALLENGE_RESOLVER_REASON_INVALID");
  return {
    status: result.status,
    ...(reference ? { reference } : {}),
    ...(reason ? { reason } : {})
  };
}

function normalizeBoundedText(value: string | undefined, maximum: number, code: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new CockroachBrowserError(code, `Resolver text must contain 1 to ${maximum} printable characters.`);
  }
  return normalized;
}

async function safeTitle(page: Page): Promise<string | undefined> {
  try {
    return await page.title();
  } catch {
    return undefined;
  }
}

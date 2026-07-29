import type { Page } from "playwright-core";
import type { ChallengeReport } from "./contracts.js";

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

async function safeTitle(page: Page): Promise<string | undefined> {
  try {
    return await page.title();
  } catch {
    return undefined;
  }
}

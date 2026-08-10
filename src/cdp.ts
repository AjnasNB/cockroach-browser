import { chromium } from "playwright-core";
import type { Browser, BrowserContext, CDPSession, Frame, Page } from "playwright-core";

export type { CDPSession } from "playwright-core";

export async function connectRawCdp(endpoint: string): Promise<Browser> {
  return chromium.connectOverCDP(endpoint);
}

export async function createRawCdpSession(
  context: BrowserContext,
  target: Page | Frame
): Promise<CDPSession> {
  return context.newCDPSession(target);
}

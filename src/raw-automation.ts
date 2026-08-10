/**
 * Unrestricted operator-owned browser automation.
 *
 * This subpath deliberately returns the upstream Playwright objects. It is
 * separate from BrowserRuntime and therefore does not inherit BrowserRuntime
 * origin, effect, approval, evidence, or budget enforcement. Hosts must keep
 * it behind their own trusted operator boundary.
 */
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type BrowserType,
  type ConnectOptions,
  type ConnectOverCDPOptions,
  type LaunchOptions
} from "playwright-core";

export * from "playwright-core";

export const RAW_BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;
export type RawBrowserEngine = (typeof RAW_BROWSER_ENGINES)[number];

export interface RawBrowserLaunchInput {
  engine: RawBrowserEngine;
  options?: LaunchOptions;
}

export interface RawBrowserConnectInput {
  engine: RawBrowserEngine;
  wsEndpoint: string;
  options?: ConnectOptions;
}

export interface RawPersistentContextInput {
  engine: RawBrowserEngine;
  userDataDir: string;
  options?: Parameters<BrowserType["launchPersistentContext"]>[1];
}

export function rawBrowserType(engine: RawBrowserEngine): BrowserType {
  if (engine === "chromium") return chromium;
  if (engine === "firefox") return firefox;
  return webkit;
}

export async function launchRawBrowser(input: RawBrowserLaunchInput): Promise<Browser> {
  return rawBrowserType(input.engine).launch(input.options);
}

export async function launchRawBrowserServer(input: RawBrowserLaunchInput): Promise<BrowserServer> {
  return rawBrowserType(input.engine).launchServer(input.options);
}

export async function connectRawBrowser(input: RawBrowserConnectInput): Promise<Browser> {
  return rawBrowserType(input.engine).connect(input.wsEndpoint, input.options);
}

export async function launchRawPersistentContext(
  input: RawPersistentContextInput
): Promise<BrowserContext> {
  return rawBrowserType(input.engine).launchPersistentContext(input.userDataDir, input.options);
}

export async function connectRawChromiumOverCDP(
  endpoint: string,
  options?: ConnectOverCDPOptions
): Promise<Browser> {
  return chromium.connectOverCDP(endpoint, options);
}

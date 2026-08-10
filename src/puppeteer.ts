/**
 * Complete upstream Puppeteer Core compatibility surface.
 *
 * Consumers importing `cockroach-browser/puppeteer` receive the exact public
 * API exported by the pinned puppeteer-core dependency. This is an
 * unrestricted operator API and is intentionally separate from BrowserRuntime.
 */
export { default } from "puppeteer-core";
export * from "puppeteer-core";

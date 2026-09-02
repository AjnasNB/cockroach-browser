# Full automation platform

Use the bounded runtime, exact upstream APIs, protocols, tests, agents, fleets, or mobile transport.

Cockroach Browser keeps its policy-evaluated agent runtime separate from unrestricted operator automation while shipping both in one versioned package.

Public manual: https://cockroachbrowser.com/docs/automation-platform/

## Run Chromium, Firefox, and WebKit through Playwright

cockroach-browser/automation re-exports the complete pinned playwright-core package. Browser, context, page, frame, locator, handle, worker, request, response, route, WebSocket, tracing, HAR, clock, emulation, download, video, and protocol APIs retain their upstream contracts. This unrestricted operator surface does not inherit bounded-runtime origin or budget policy.

```
import { chromium, firefox, webkit } from "cockroach-browser/automation";

for (const engine of [chromium, firefox, webkit]) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://example.com/");
  console.log(await page.title());
  await browser.close();
}
```

## Use every pinned Puppeteer Core export

cockroach-browser/puppeteer is an exact default and named re-export of puppeteer-core. It includes Browser, BrowserContext, Page, Frame, Locator, ElementHandle, JSHandle, Target, WebWorker, CDPSession, coverage, tracing, heap, metrics, emulation, and screencast contracts. The generated API inventory records every public owner and member from the installed declarations.

```
import puppeteer from "cockroach-browser/puppeteer";

const browser = await puppeteer.connect({ browserWSEndpoint: process.env.BROWSER_WS_ENDPOINT });
const page = await browser.newPage();
const client = await page.createCDPSession();
console.log(await client.send("Performance.getMetrics"));
await browser.disconnect();
```

## Run tests and generate cross-language scripts

cockroach-browser/test exposes Playwright Test fixtures and assertions. cockroach-browser-test runs the upstream test runner. cockroach-browser-codegen records JavaScript, TypeScript, Python, Java, or C# scripts. Projects, retries, reporters, snapshots, parallelism, trace, and multi-engine configuration remain upstream Playwright behavior.

```
cockroach-browser-codegen --target=python https://example.com/
cockroach-browser-test --project=chromium
cockroach-browser-test --project=firefox
cockroach-browser-test --project=webkit
```

## Use CDP, WebDriver BiDi, Safari, iOS, and Android endpoints

The CDP module creates raw sessions for Chromium pages and frames. The BiDi module sends arbitrary bounded commands and subscriptions to an operator-owned WebSocket. The mobile module is a raw W3C WebDriver/Appium transport for operator-supplied Safari, iOS, Android, and vendor endpoints. Cockroach Browser does not bundle a macOS Safari host, simulator, emulator, or device lab.

```
import { WebDriverClient } from "cockroach-browser/mobile";

const client = new WebDriverClient({
  endpoint: "https://appium.example/wd/hub",
  headers: { authorization: "Bearer " + process.env.MOBILE_TOKEN }
});
const safari = await client.createSession({
  alwaysMatch: {
    platformName: "iOS",
    browserName: "Safari",
    "appium:deviceName": "reviewed-device"
  }
});
await safari.navigate("https://example.com/");
await safari.close();
```

## Run the optional model gateway and finite-step agent

The OpenAI-compatible gateway resolves its API key in the trusted host, applies its deadline to API-key-provider waiting and the HTTP exchange, enforces independent maxRequestBytes and maxResponseBytes ceilings, and parses structured tool calls. The agent validates every action payload against the published schema before runtime dispatch, refuses mixed action-and-finish output, observes a fresh bounded snapshot after every non-snapshot action, retains receipts, and accepts completion only on a later reviewed turn. maxContextChars bounds each serialized model turn, maxToolOutputChars bounds each tool result, and compaction removes only complete older assistant/tool rounds while retaining digest, receipt, evidence, and citation anchors. Optional cited history is serialized as an untrusted user-role observation behind the trusted system boundary, never as an instruction or authority. A host can omit this layer and use any external planner.

```
import { BrowserAgent } from "cockroach-browser/agent";
import { OpenAICompatibleModelGateway } from "cockroach-browser/model-gateway";

const gateway = new OpenAICompatibleModelGateway({
  endpoint: process.env.MODEL_ENDPOINT,
  model: process.env.MODEL_NAME,
  apiKeyProvider: () => process.env.MODEL_API_KEY,
  maxRequestBytes: 4 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024
});
const agent = new BrowserAgent({
  runtime,
  gateway,
  maxSteps: 30,
  maxContextChars: 128_000,
  maxToolOutputChars: 32_000
});
const result = await agent.run({
  sessionId: session.id,
  task: "Inspect the release page and report the visible version"
});
```

## Allocate local or provider-managed browser capacity

The local fleet launches real Chromium, Firefox, or WebKit browser servers with capacity and TTL enforcement. The HTTP provider adapter requires exact declared engines, regions, proxy classes, challenge modes, and live-view behavior. Residential/static IPs, provider challenge services, live viewers, and hosted capacity remain external infrastructure selected by the operator.

```
import { BrowserFleet, LocalBrowserFleetProvider, HttpBrowserFleetProvider } from "cockroach-browser/fleet";

const fleet = new BrowserFleet({
  maxSessions: 8,
  providers: [
    new LocalBrowserFleetProvider({ maxSessions: 4 }),
    new HttpBrowserFleetProvider({
      id: "operator-cloud",
      endpoint: "https://browser-provider.example/",
      tokenProvider: readFleetToken,
      capabilities: reviewedProviderCapabilities
    })
  ]
});
```

## Call the authenticated daemon from six languages

TypeScript is the native embedded and daemon SDK. Dependency-light Python, Java, .NET/C#, Ruby, and Go clients expose health, capabilities, sessions, actions, batches, snapshots, and generic route access. These clients preserve server errors and caller-owned timeouts; they do not pretend to reimplement every upstream browser object in every language.

```
# TypeScript: import { BrowserClient } from "cockroach-browser/client"
# Python:     from cockroach_browser import BrowserClient
# Java:       new io.cockroach.browser.Client(baseUrl, token, timeout)
# .NET:       new CockroachBrowser.BrowserClient(httpClient, baseUrl, token)
# Ruby:       CockroachBrowser::Client.new(base_url:, token:)
# Go:         cockroachbrowser.NewClient(baseURL, token, httpClient)
```


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.

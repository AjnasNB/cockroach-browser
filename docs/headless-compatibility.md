# Headless browser compatibility

This is the maintained, practical headless-browser landscape, not a claim that every abandoned wrapper on every package registry is embedded in Cockroach Browser.

## Browser engines and device surfaces

| Surface | Cockroach Browser route | Status |
|---|---|---|
| Chromium / Chrome / Edge | Bounded Playwright runtime, raw Playwright, raw Puppeteer, CDP, system/custom executable discovery | Native |
| Firefox | Bounded and raw Playwright; raw Puppeteer/BiDi where upstream supports it | Native |
| WebKit | Bounded and raw Playwright | Native |
| Safari on macOS | W3C WebDriver endpoint supplied by the operator | Adapter |
| Android Chrome / WebView | W3C WebDriver or Appium endpoint supplied by the operator | Adapter |
| iOS Safari / WebView | W3C WebDriver or Appium endpoint supplied by the operator | Adapter |
| Remote browser farms | Authenticated fleet provider declaring engines, regions, TTL, proxy classes, and live-view capability | Adapter |
| Obscura | Explicit runtime-owned loopback CDP process, optionally pinned to a reviewed SHA-256 digest | Experimental lightweight provider |
| Lightpanda | Manifest, configuration validation, and machine preflight are present; managed launch fails closed until an engine- or OS-level boundary covers all HTTP, WebSocket, worker, and related egress | Preflight only on current main |

Playwright documents Chromium, Firefox, WebKit, Chrome, and Edge channels in its [browser guide](https://playwright.dev/docs/browsers). Puppeteer documents Chrome and Firefox over CDP and WebDriver BiDi in [What is Puppeteer?](https://pptr.dev/guides/what-is-puppeteer). Selenium documents its cross-browser WebDriver implementations in [Supported Browsers](https://www.selenium.dev/documentation/webdriver/browsers/) and the event-driven BiDi surface in [WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/).

## Main automation projects

| Project or family | Primary role | Cockroach Browser relationship |
|---|---|---|
| Playwright | Cross-engine browser automation and test runner | Complete pinned API export plus bounded runtime |
| Puppeteer Core | Chrome/Firefox automation, CDP/BiDi, profiling | Complete pinned API export |
| Selenium WebDriver / Grid | Cross-language W3C automation and distributed execution | WebDriver and BiDi clients; operator supplies endpoint |
| WebdriverIO | JavaScript WebDriver/BiDi test and automation framework | Compatible through external WebDriver endpoints; not embedded |
| Cypress | Browser-focused application testing | Alternative test runner; not embedded |
| Playwright MCP | Accessibility-snapshot-oriented MCP tools over Playwright | Compatible external MCP/tool surface; Cockroach keeps its own policy and evidence boundary ([Playwright MCP](https://github.com/microsoft/playwright-mcp)) |
| Browser Use | Python agent orchestration over browsers | Compatible external planner; not embedded ([Browser Use](https://github.com/browser-use/browser-use)) |
| Stagehand | Agent-oriented browser API over Playwright/CDP | Compatible external planner/provider; not embedded ([Stagehand](https://github.com/browserbase/stagehand)) |
| agent-browser | CLI-oriented browser automation for agents | Alternative client/tool surface; not embedded ([agent-browser](https://github.com/vercel-labs/agent-browser)) |
| chromedp | Go CDP automation | Alternative CDP client; Cockroach exposes raw CDP and a Go daemon SDK |
| Rod | Go CDP automation with waits, frames, shadow DOM, and hijacking | Alternative CDP client; not embedded ([Rod](https://github.com/go-rod/rod)) |
| Browserless | Hosted/self-hosted remote browser infrastructure | Connect through explicit CDP or fleet provider; service not bundled |
| Steel | Session-oriented hosted/self-hosted browser infrastructure with live view and debugging | Fleet/live-view design reference or explicit remote provider; service not bundled |
| Splash | Scriptable rendering service | Specialized remote renderer; not embedded |
| HtmlUnit | JVM browser simulation without a full graphical engine | Specialized DOM/browser simulator; not embedded |
| Servo / Ladybird | Independent browser-engine projects | Experimental engine research; no bounded Cockroach provider is claimed ([Servo](https://github.com/servo/servo), [Ladybird](https://github.com/LadybirdBrowser/ladybird)) |
| Ferrum | Ruby CDP automation | Alternative CDP client; Cockroach supplies a Ruby daemon SDK |
| Taiko | JavaScript Chromium automation | Alternative Chromium harness; not embedded |
| PhantomJS / Zombie.js | Historical headless/simulated-browser projects | Legacy only; not selected for the maintained runtime |

## Independent lightweight engines

Obscura and Lightpanda are independent engines, not small Chromium builds. They can materially reduce memory for compatible DOM and JavaScript workloads, but neither is presented as a drop-in replacement for every Chromium, Firefox, or WebKit behavior.

The managed Obscura provider is deliberately explicit:

- The operator supplies the executable and implementation identity. A reviewed SHA-256 digest is optional, and Cockroach Browser never downloads or silently substitutes a binary.
- The runtime starts one owned process on a reserved `127.0.0.1` port with fixed arguments, bounded diagnostics, and a minimal environment.
- Arbitrary launch flags, remote endpoints, extensions, persistent profiles, headed mode, and proxy credentials are rejected on this route.
- The session discloses the independent provider identity and experimental maturity. A machine-readable engine manifest distinguishes supported, experimental, and unsupported capabilities before an action executes.
- Unsupported work routes to a full engine only when the host deliberately creates that full-engine session; the runtime does not silently change engines inside a governed session.

Lightpanda has a machine-readable manifest, configuration validation, and host preflight on current `main`, but it is not a managed execution provider yet. Its managed launch fails closed because a page-route hook does not cover every browser egress channel, including WebSockets and worker-originated traffic. Enabling it requires a complete engine- or OS-level network boundary and regression evidence for those paths.

Obscura documents partial CDP plus Playwright/Puppeteer integration and publishes separate conformance and benchmark evidence in its [engine repository](https://github.com/h4ckf0r0day/obscura) and [benchmark repository](https://github.com/h4ckf0r0day/obscura-benchmark). Obscura 0.2.1 also documents rendering and screenshot improvements in its [release notes](https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.1). Cockroach Browser's `rendering: "none"` setting means visual actions are denied at capability preflight; it does not assert that the selected binary disabled or omitted its renderer. Lightpanda documents its CDP server and rendererless platform boundary in its [engine repository](https://github.com/lightpanda-io/browser) and [official documentation](https://github.com/lightpanda-io/docs). Those upstream results are evidence about specific versions and fixtures, not a Cockroach Browser guarantee.

## Negotiate capabilities before launch

Capability negotiation is machine-readable and independent of session creation:

- `GET /v1/engines` returns every engine manifest; `GET /v1/engines?engine=obscura` filters it.
- `BrowserClient.engines(engine?)` exposes the same authenticated HTTP surface.
- MCP tool `browser_engines` returns manifests without launching a browser.
- MCP tool `browser_engine_preflight` accepts one engine, one or more exact action kinds, and optional `allowExperimental`. It returns each required capability, state, note, acceptance decision, and unmet set without launching a browser.

Supported capabilities are admitted. Experimental capabilities fail closed unless the caller explicitly opts in. Unsupported capabilities always fail. The `runtime.owned_launch` manifest entry is supported for Chromium, Firefox, and WebKit; experimental for Obscura; and unsupported for Lightpanda. A successful preflight describes compatibility; it does not create a session, grant origins or credentials, expand policy, or prove that a later page will behave correctly.

## Measured non-visual result

On September 3, 2026, the pinned Obscura 0.2.1 binary (`5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221`) ran one warmup plus 20 measured launches per target of the constrained non-visual fixture. Every launch retained ten steady-state samples at 25 ms intervals in addition to boundary observations. The 30 MiB target passed with a maximum complete owned-browser-process-tree RSS of 29,622,272 bytes (28.25 MiB). The 25 MiB target failed with a 29,679,616-byte maximum (28.30 MiB). CDP connection, JavaScript, DOM, forms, screenshot preflight denial, and verified teardown passed in every measured launch.

The Node coordinator was measured separately. This result is not evidence that the whole app, coordinator, rendered pages, full Chromium/Firefox/WebKit sessions, or arbitrary sites use 30 MiB; full engines use far more memory. See the [canonical proof record](./benchmarks/obscura-non-visual-2026-09-03.md) and [resource-governance methodology](./resource-governance.md).

## Feature coverage

Cockroach Browser exposes two deliberately separate layers:

- The raw layer preserves complete pinned Playwright and Puppeteer APIs, Playwright Test/codegen, CDP, BiDi, and WebDriver/Appium transports.
- The bounded agent layer adds origin/effect policy, exact approvals, finite budgets, semantic references, evidence, receipts, challenges, team access, jobs, MCP, SDKs, and a model-driven agent loop.

The bounded runtime currently covers navigation, tabs/popups, forms, keyboard, mouse, drag/drop, open shadow DOM, same-origin frames, JavaScript under policy, cookies/storage/state, uploads/downloads, dialogs, network inspection and HTTP(S) routing, WebSocket-handshake validation for runtime-owned full engines, screenshots, PDF on Chromium, traces, HAR, video, audits, visual comparison, profiles, proxies, emulation, and Chromium/Firefox/WebKit execution. Service workers are blocked in bounded full-engine contexts. These application controls do not contain WebRTC/STUN/TURN/UDP, WebTransport/QUIC, attached CDP, lightweight-engine WebSockets, or raw operator traffic; use deployment-owned OS or container egress controls for hostile content. Advanced unrestricted objects such as arbitrary handles, raw workers, every protocol command, browser extensions, CPU profiles, heap snapshots, and screencasting stay on the raw operator layer rather than being disguised as safe agent actions.

Feature coverage is a routed union, not a claim that one engine implements the entire web platform. The full Playwright/Puppeteer layer owns graphical rendering, tracing, video, browser extensions, persistent profiles, comprehensive frames/shadow DOM, and raw protocol access. The managed Obscura non-visual lane targets compatible navigation, JavaScript, DOM, structured extraction, HTMLElement activation, and input/textarea value assignment without visual pointer fidelity. Lightpanda remains a fail-closed manifest/preflight route until its complete egress boundary exists. WebDriver/Appium and fleet adapters cover operator-owned browsers, devices, regions, and live-view systems. Cockroach Browser policy, approvals, budgets, evidence, and receipts govern bounded-runtime routes; raw and external operator-owned surfaces retain their own authority boundaries.

## Honest boundaries

- A local Windows or Linux installation does not become a real macOS Safari or iOS device. Those require an operator-owned Apple host or device provider.
- Cockroach Browser does not operate a proxy network, CAPTCHA bypass, residential identity pool, or hosted browser fleet.
- Playwright, Puppeteer, Selenium, Cypress, and the language-specific CDP clients are different harnesses over overlapping browser engines. Copying every wrapper would add dependency and security cost without adding engine capability.
- “All headless features” means the pinned upstream raw APIs plus the documented bounded actions and adapters. The machine-readable capability registry is the release contract.
- The observed 30 MiB pass applies only to the named pinned Obscura binary, non-visual fixture, host, and complete owned browser process tree. The corresponding 25 MiB run failed, and whole-app/coordinator memory is not included in the 30 MiB result.

# Third-party notices

Cockroach Browser is original software distributed under AGPL-3.0-or-later. Its direct runtime dependencies are separately licensed by their respective authors.

The exact versions shipped in an npm artifact are recorded in `package-lock.json` and in npm provenance. The following direct dependencies are included:

| Package | License | Project |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | MIT | <https://github.com/modelcontextprotocol/typescript-sdk> |
| `pixelmatch` | ISC | <https://github.com/mapbox/pixelmatch> |
| `playwright-core` | Apache-2.0 | <https://github.com/microsoft/playwright> |
| `pngjs` | MIT | <https://github.com/pngjs/pngjs> |
| `zod` | MIT | <https://github.com/colinhacks/zod> |

Chromium is installed separately by the setup command or container build. Chromium and its bundled components have their own open-source licenses. See Chromium's license page at <https://www.chromium.org/chromium-os/licenses/> and the license inventory in the installed browser distribution.

MCP is a protocol integration. Maqam, Qarinah, Cockroach Crawler, and ProductLoop OS are separate packages and repositories. Their licenses and notices remain authoritative for their code.

No trademark rights are granted by this file. Cockroach Browser is not affiliated with browser vendors or the maintainers of its dependencies.

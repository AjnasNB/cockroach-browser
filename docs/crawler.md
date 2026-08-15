# Cockroach Crawler integration

Use the crawler for breadth. Use the browser for one rendered path.

Cockroach Crawler maps and extracts public web content at bounded scale. Cockroach Browser handles stateful rendering, semantic interactions, screenshots, audits, and user-authorized sessions.

Public manual: https://cockroachbrowser.com/docs/crawler/

## Choose the right engine

Start with the crawler for static HTTP, searched site maps, structured extraction, documents, feeds, public-source breadth, and bounded crawl jobs. Hand a specific URL to the browser when JavaScript rendering, page state, interaction, or browser evidence is required.

## Handoff explicit URLs and finite budgets

The adapter passes explicit seed URLs, allowed origins, page ceilings, and other finite crawl budgets. Keep the browser-session purpose in local browser evidence and host orchestration records; it is not crawler authority. The handoff never shares browser profiles, cookies, authenticated state, session secrets, or interactive browser state.

## Normalize the evidence

Keep source URL, capture time, content digest, extraction method, and failure state across the handoff. Maqam may govern both tools while retaining separate receipts and effect models.

## Avoid duplicate work

Map once with the crawler, rank candidate pages, then render only the pages that need a browser. This preserves browser budgets and makes the reason for each rendered session visible.


## Release status

This manual targets Cockroach Browser 0.4.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.

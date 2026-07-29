import { createCrawlerHandoff } from "cockroach-browser/crawler";

const crawlerCalls = [];
const handoff = createCrawlerHandoff({
  async crawlDetailed(input) {
    crawlerCalls.push(structuredClone(input));
    return {
      pages: [{ url: input.seeds[0], title: "Example documentation" }],
      failures: []
    };
  }
});

const purpose = "Collect cited documentation for a local browser receipt";
const crawlerResult = await handoff.crawl({
  seeds: ["https://docs.example.com/start"],
  allowedOrigins: ["https://docs.example.com"],
  maxPages: 12,
  purpose
});

const localReceipt = {
  purpose,
  crawlerResult
};

console.log(JSON.stringify({
  forwardedToCrawler: crawlerCalls[0],
  localReceipt
}, null, 2));

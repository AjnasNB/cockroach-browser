import type { CrawlerHandoff } from "../contracts.js";

export interface CockroachCrawlerLike {
  crawlDetailed(input: {
    seeds: string[];
    allowedOrigins: string[];
    maxPages: number;
    purpose?: string;
  }): Promise<unknown>;
}

/** Delegates broad collection to Cockroach Crawler without sharing browser profiles or session state. */
export function createCrawlerHandoff(crawler: CockroachCrawlerLike): CrawlerHandoff {
  return {
    crawl(input) {
      return crawler.crawlDetailed({
        seeds: [...input.seeds],
        allowedOrigins: [...input.allowedOrigins],
        maxPages: input.maxPages,
        purpose: input.purpose
      });
    }
  };
}

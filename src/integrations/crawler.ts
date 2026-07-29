import type { CrawlerHandoff } from "../contracts.js";

export interface CockroachCrawlerLike {
  crawlDetailed(input: {
    seeds: string[];
    allowedOrigins: string[];
    maxPages: number;
  }): Promise<unknown>;
}

/**
 * Delegates broad collection to Cockroach Crawler without sharing purpose,
 * browser profiles, credentials, cookies, or session state.
 */
export function createCrawlerHandoff(crawler: CockroachCrawlerLike): CrawlerHandoff {
  return {
    crawl(input) {
      return crawler.crawlDetailed({
        seeds: [...input.seeds],
        allowedOrigins: [...input.allowedOrigins],
        maxPages: input.maxPages
      });
    }
  };
}

import type { AppEnv } from "@/db/runtime";
import { saveSearchContents } from "@/db/search";
import { createJob, finishJob } from "@/db/repository";
import { fetchTikHubSource } from "./connectors/tikhub";
import { searchGitHubTopic } from "./connectors/github";
import { LIVE_SEARCH_LIMIT, searchSince, type PlatformSearchResult, type SearchOptions } from "./topic-search";
import type { ContentItem, Platform, Source } from "./types";

export function topicSearchSource(platform: Platform, options: SearchOptions): Source {
  const since = searchSince(options.range)!;
  return {
    id: `search-${platform}`, name: `话题搜索 · ${options.query}`, platform, kind: "keyword",
    target: platform === "x" ? `${options.query} since:${since.slice(0, 10)}` : options.query,
    intervalMinutes: 0, enabled: false, status: "paused", lastSyncedAt: null, itemCount: 0,
    config: {
      maxPages: 1, maxItems: LIVE_SEARCH_LIMIT, minValueScore: 0,
      searchType: options.sort === "latest" ? "Latest" : "Top",
      sortBy: options.sort === "latest" ? "upload_date" : "relevance",
      timeRange: { all: "this_year", week: "this_week", month: "this_month", year: "this_year" }[options.range],
      languageCode: "en", countryCode: "us",
    },
  };
}

export async function searchLiveTopics(options: SearchOptions, env: AppEnv) {
  const results = await Promise.all(options.platforms.map(async (platform): Promise<{
    status: PlatformSearchResult; items: ContentItem[];
  }> => {
    if (platform !== "github" && !env.TIKHUB_TOKEN?.trim()) {
      return { items: [], status: { platform, status: "failed", count: 0, added: 0,
        error: "请先在系统设置中配置个人 TikHub API Key" } };
    }
    const source = topicSearchSource(platform, options);
    const started = Date.now();
    let jobId: string | undefined;
    let requestId: string | undefined;
    let billable = false;
    try {
      // Ensure storage works before spending a paid API request.
      jobId = (await createJob(source)).id;
      const result = platform === "github"
        ? await searchGitHubTopic(options.query, env, {
          latest: options.sort === "latest", since: searchSince(options.range)!, limit: LIVE_SEARCH_LIMIT,
        })
        : await fetchTikHubSource(source, env);
      requestId = result.requestId;
      billable = result.billable;
      const saved = await saveSearchContents(result.items.slice(0, LIVE_SEARCH_LIMIT), options.query);
      await finishJob(jobId, { status: "succeeded", itemsFound: saved.items.length,
        itemsAdded: saved.added, durationMs: Date.now() - started, billable, requestId });
      return { items: saved.items, status: { platform, status: "succeeded", count: saved.items.length, added: saved.added } };
    } catch (error) {
      // Never send upstream error bodies or keys back to the browser.
      const raw = error instanceof Error ? error.message : "";
      const message = raw.includes("超时") || (error instanceof Error && error.name === "AbortError")
        ? "平台响应超时，请稍后重试"
        : raw.includes("429") || raw.includes("额度") || raw.includes("余额")
          ? "平台额度不足或请求过于频繁，请检查额度后重试"
          : raw.includes("401") || raw.includes("403")
            ? "平台鉴权失败或访问受限，请检查 Key 与账号权限"
            : "搜索或保存失败，请检查平台配置与采集服务后重试";
      if (jobId) {
        await finishJob(jobId, { status: "failed", itemsFound: 0, itemsAdded: 0,
          durationMs: Date.now() - started, errorMessage: message, requestId, billable }).catch(() => {});
      }
      return { items: [], status: { platform, status: "failed", count: 0, added: 0, error: message } };
    }
  }));
  // Interleave platform rankings rather than comparing incompatible platform scores.
  const items: ContentItem[] = [];
  for (let index = 0; index < LIVE_SEARCH_LIMIT; index++) {
    for (const result of results) if (result.items[index]) items.push(result.items[index]);
  }
  return { items, platforms: results.map((result) => result.status) };
}

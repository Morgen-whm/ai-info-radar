import type { ContentItem, Platform, RewriteJob } from "./types";

export const searchPlatforms: { id: Platform; label: string; live: boolean }[] = [
  { id: "x", label: "X / Twitter", live: true },
  { id: "youtube", label: "YouTube", live: true },
  { id: "github", label: "GitHub", live: true },
  { id: "linuxdo", label: "Linux.do", live: false },
  { id: "idcflare", label: "IDCFlare", live: false },
  { id: "gitlab", label: "GitLab", live: false },
];

export interface SearchOptions {
  query: string;
  platforms: Platform[];
  sort: "relevance" | "latest";
  range: "all" | "week" | "month" | "year";
  page: number;
}

export interface PlatformSearchResult {
  platform: Platform;
  status: "succeeded" | "failed";
  count: number;
  added: number;
  error?: string;
}

export interface TopicSearchResponse {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  reviewInboxIds: string[];
  rewriteJobs: RewriteJob[];
  platforms?: PlatformSearchResult[];
}

export const SEARCH_PAGE_SIZE = 30;
export const LIVE_SEARCH_LIMIT = 30;

export function parseSearchOptions(value: unknown, live = false): SearchOptions {
  if (!value || typeof value !== "object") throw new Error("搜索参数不正确");
  const input = value as Record<string, unknown>;
  const query = typeof input.query === "string" ? input.query.trim().replace(/\s+/g, " ") : "";
  if (!query || query.length > 160) throw new Error("请输入 1—160 个字符的话题关键词");
  if (query.split(" ").length > 12) throw new Error("关键词请控制在 12 组以内");
  if (!Array.isArray(input.platforms) || !input.platforms.length || input.platforms.length > 6) {
    throw new Error("请至少勾选一个搜索平台");
  }
  const platforms = [...new Set(input.platforms)] as Platform[];
  if (platforms.some((id) => !searchPlatforms.some((item) => item.id === id && (!live || item.live)))) {
    throw new Error(live ? "实时搜索仅支持 X、YouTube 和 GitHub；其他平台请搜索已采集内容" : "包含不支持的平台");
  }
  const sort = input.sort ?? "relevance";
  const range = input.range ?? (live ? "month" : "all");
  if (sort !== "relevance" && sort !== "latest") throw new Error("不支持的排序方式");
  if (!["all", "week", "month", "year"].includes(String(range)) || (live && range === "all")) {
    throw new Error("不支持的搜索时间范围");
  }
  const page = Number(input.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000 || (live && page !== 1)) {
    throw new Error("搜索页码不正确");
  }
  return { query, platforms, sort, range: range as SearchOptions["range"], page };
}

export function searchSince(range: SearchOptions["range"], now = Date.now()): string | null {
  const days = { all: 0, week: 7, month: 30, year: 365 }[range];
  return days ? new Date(now - days * 86_400_000).toISOString() : null;
}

export function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Parameters are always bound separately; SQL syntax comes only from this module.
export function buildSearchSql(options: SearchOptions, now = Date.now()) {
  const clauses = [`c.platform IN (${options.platforms.map(() => "?").join(",")})`];
  const bindings: (string | number)[] = [...options.platforms];
  for (const term of options.query.split(" ")) {
    clauses.push("(c.title || ' ' || c.body || ' ' || c.author_name || ' ' || COALESCE(c.author_handle, '') || ' ' || c.tags_json) LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeSearchLike(term)}%`);
  }
  const since = searchSince(options.range, now);
  if (since) { clauses.push("c.published_at >= ?"); bindings.push(since); }
  const order = options.sort === "latest"
    ? "c.published_at DESC, c.id DESC"
    : "CASE WHEN c.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END DESC, c.hot_score DESC, c.published_at DESC, c.id DESC";
  return {
    where: clauses.join(" AND "), bindings, order,
    orderBindings: options.sort === "latest" ? [] : [`%${escapeSearchLike(options.query)}%`],
  };
}

import type {
  ConnectorResult,
  NormalizedContentInput,
  Source,
} from "../types";
import {
  authorFrom,
  collectCandidateObjects,
  firstNumber,
  firstString,
  metricsFrom,
  normalizeDate,
  record,
} from "./helpers";
import type { AppEnv } from "@/db/runtime";
import { requestTikHub } from "../tikhub-client";
import { getSourceCollectionConfig } from "../source-config";

function normalizeXItems(
  data: unknown,
  source: Source,
): NormalizedContentInput[] {
  if (source.kind === "trending") {
    const trends = collectCandidateObjects(
      data,
      (item) =>
        Boolean(item.name || item.trend_name || item.query) &&
        Boolean(item.url || item.tweet_volume || item.volume),
      30,
    );
    return trends.map((item, index) => {
      const title = firstString(item, ["name", "trend_name", "query"], "X 趋势");
      return {
        externalId: firstString(item, ["id", "query"], `trend-${title}`),
        platform: "x",
        type: "post",
        title,
        body: `X 地区趋势第 ${index + 1} 位`,
        url:
          firstString(item, ["url"]) ||
          `https://x.com/search?q=${encodeURIComponent(title)}`,
        authorName: "X Trending",
        publishedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        metrics: {
          views: firstNumber(item, ["tweet_volume", "volume", "post_count"]),
        },
        tags: ["X趋势", title.replace(/^#/, "")],
        raw: item,
      };
    });
  }

  const candidates = collectCandidateObjects(
    data,
    (item) => {
      const legacy = record(item.legacy);
      return Boolean(
        item.tweet_id ||
          item.rest_id ||
          item.id_str ||
          item.full_text ||
          item.text ||
          legacy.full_text,
      );
    },
    50,
  );

  const deduped = new Map<string, NormalizedContentInput>();
  for (const item of candidates) {
    const legacy = record(item.legacy);
    const id = firstString(
      { ...item, ...legacy },
      ["tweet_id", "rest_id", "id_str", "id"],
    );
    const text = firstString(
      { ...item, ...legacy },
      ["full_text", "text", "content"],
    );
    if (!id || !text || deduped.has(id)) continue;
    const author = authorFrom(item, "x");
    const handle = author.handle.replace(/^@/, "");
    deduped.set(id, {
      externalId: id,
      platform: "x",
      type: "post",
      title: text.length > 92 ? `${text.slice(0, 92)}…` : text,
      body: text,
      url:
        firstString(item, ["url", "tweet_url"]) ||
        `https://x.com/${handle || "i"}/status/${id}`,
      authorName: author.name,
      authorHandle: author.handle ? `@${handle}` : undefined,
      publishedAt: normalizeDate(
        legacy.created_at ?? item.created_at ?? item.timestamp,
      ),
      fetchedAt: new Date().toISOString(),
      metrics: metricsFrom({ ...item, ...legacy }),
      tags: source.target
        .replace(/[()"']/g, " ")
        .split(/\s+(?:OR\s+)?/i)
        .filter((tag) => tag.length > 2)
        .slice(0, 5),
      raw: item,
    });
  }
  return [...deduped.values()];
}

function normalizeYouTubeItems(
  data: unknown,
  source: Source,
): NormalizedContentInput[] {
  const candidates = collectCandidateObjects(
    data,
    (item) =>
      Boolean(
        item.video_id ||
          item.videoId ||
          record(item.id).videoId ||
          (item.title && (item.thumbnail || item.thumbnails)),
      ),
    50,
  );
  const deduped = new Map<string, NormalizedContentInput>();
  for (const item of candidates) {
    const idObject = record(item.id);
    const id = firstString(
      { ...item, ...idObject },
      ["video_id", "videoId", "id"],
    );
    const titleValue = item.title;
    const title =
      typeof titleValue === "string"
        ? titleValue
        : firstString(record(titleValue), ["text", "simpleText"]);
    if (!id || !title || deduped.has(id)) continue;
    const author = authorFrom(item, "youtube");
    const duration = firstString(item, [
      "duration",
      "length_text",
      "lengthText",
    ]);
    deduped.set(id, {
      externalId: id,
      platform: "youtube",
      type:
        source.target.toLowerCase().includes("short") ||
        firstString(item, ["url"]).includes("/shorts/")
          ? "short"
          : "video",
      title,
      body: firstString(item, [
        "description",
        "description_snippet",
        "short_description",
        "snippet",
      ]),
      url:
        firstString(item, ["url", "video_url"]) ||
        `https://www.youtube.com/watch?v=${id}`,
      authorName: author.name,
      authorHandle: author.handle || undefined,
      publishedAt: normalizeDate(
        item.published_at ??
          item.publish_date ??
          item.published_time ??
          item.publishedTime ??
          item.publishedTimeText ??
          item.timestamp,
      ),
      fetchedAt: new Date().toISOString(),
      metrics: metricsFrom(item),
      tags: [
        "YouTube",
        ...(duration ? [duration] : []),
        ...source.target.split(/\s+/).filter((tag) => tag.length > 2).slice(0, 4),
      ],
      raw: item,
    });
  }
  return [...deduped.values()];
}

function findPaginationToken(
  data: unknown,
  platform: Source["platform"],
): string | undefined {
  const preferredKeys =
    platform === "x"
      ? ["next_cursor", "bottom_cursor", "cursor_bottom"]
      : [
          "continuation_token",
          "next_continuation_token",
          "nextContinuation",
          "continuation",
        ];
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: data, depth: 0 },
  ];
  const visited = new Set<object>();

  while (queue.length) {
    const current = queue.shift()!;
    if (
      !current.value ||
      typeof current.value !== "object" ||
      current.depth > 8 ||
      visited.has(current.value)
    ) {
      continue;
    }
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    const item = current.value as Record<string, unknown>;
    for (const key of preferredKeys) {
      const token = item[key];
      if (typeof token === "string" && token.length > 4) return token;
    }
    if (
      platform === "x" &&
      String(item.cursorType ?? item.cursor_type).toLowerCase() === "bottom" &&
      typeof item.value === "string"
    ) {
      return item.value;
    }
    if (
      platform === "x" &&
      typeof item.entryId === "string" &&
      item.entryId.startsWith("cursor-bottom")
    ) {
      const content = record(item.content);
      if (typeof content.value === "string") return content.value;
    }
    for (const value of Object.values(item)) {
      if (value && typeof value === "object") {
        queue.push({ value, depth: current.depth + 1 });
      }
    }
  }
  return undefined;
}

export async function fetchTikHubSource(
  source: Source,
  env: AppEnv,
): Promise<ConnectorResult> {
  let path = "";
  let params: Record<string, string | number | boolean | undefined> = {};
  const config = getSourceCollectionConfig(source);

  if (source.platform === "x") {
    if (source.kind === "trending") {
      path = "/api/v1/twitter/web/fetch_trending";
      params = { country: source.target || "UnitedStates" };
    } else if (source.kind === "account") {
      path = "/api/v1/twitter/web/fetch_user_post_tweet";
      params = { screen_name: source.target.replace(/^@/, "") };
    } else {
      path = "/api/v1/twitter/web/fetch_search_timeline";
      params = { keyword: source.target, search_type: config.searchType };
    }
  } else if (source.platform === "youtube") {
    if (source.kind === "trending") {
      path = "/api/v1/youtube/web/get_trending_videos";
      params = {
        language_code: config.languageCode,
        country_code: source.target || config.countryCode,
      };
    } else if (source.kind === "channel") {
      path = "/api/v1/youtube/web_v2/get_channel_videos";
      params = { channel_id: source.target, need_format: true };
    } else {
      path = "/api/v1/youtube/web_v2/get_general_search_v2";
      params = {
        keyword: source.target,
        upload_date: config.timeRange,
        sort_by: config.sortBy,
        language_code: config.languageCode,
        country_code: config.countryCode,
        need_format: true,
      };
    }
  } else {
    throw new Error("TikHub 连接器不支持该平台");
  }

  const items = new Map<string, NormalizedContentInput>();
  const seenTokens = new Set<string>();
  let requestId: string | undefined;
  let nextCursor: string | undefined;

  for (let page = 0; page < config.maxPages; page += 1) {
    const pageParams = { ...params };
    if (page > 0 && nextCursor) {
      if (source.platform === "x") {
        pageParams.cursor = nextCursor;
      } else {
        pageParams.continuation_token = nextCursor;
      }
    }
    const response = await requestTikHub(env, path, pageParams);
    requestId = response.request_id || requestId;
    const normalized =
      source.platform === "x"
        ? normalizeXItems(response.data, source)
        : normalizeYouTubeItems(response.data, source);
    for (const item of normalized) {
      items.set(`${item.platform}:${item.externalId}`, item);
      if (items.size >= config.maxItems) break;
    }
    if (items.size >= config.maxItems || page + 1 >= config.maxPages) {
      nextCursor = findPaginationToken(response.data, source.platform);
      break;
    }
    const token = findPaginationToken(response.data, source.platform);
    if (!token || seenTokens.has(token)) {
      nextCursor = undefined;
      break;
    }
    seenTokens.add(token);
    nextCursor = token;
  }

  return {
    items: [...items.values()].slice(0, config.maxItems),
    requestId,
    nextCursor,
    billable: true,
  };
}

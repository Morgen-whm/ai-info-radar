import type { ContentMetrics, Platform } from "../types";

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const firstString = (
  value: Record<string, unknown>,
  keys: string[],
  fallback = "",
): string => {
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "string" && current.trim()) return current.trim();
    if (typeof current === "number") return String(current);
  }
  return fallback;
};

export const firstNumber = (
  value: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current === "string") {
      const normalized = current.trim().replace(/,/g, "");
      const match = normalized.match(/-?\d+(?:\.\d+)?/);
      if (!match) continue;
      const base = Number(match[0]);
      if (!Number.isFinite(base)) continue;
      const suffix = normalized.slice(match.index! + match[0].length).trim();
      const multiplier =
        /^[kK千]/.test(suffix)
          ? 1_000
          : /^[mM]/.test(suffix)
            ? 1_000_000
            : /^[bB]/.test(suffix)
              ? 1_000_000_000
              : /^万/.test(suffix)
                ? 10_000
                : /^亿/.test(suffix)
                  ? 100_000_000
                  : 1;
      return base * multiplier;
    }
  }
  return undefined;
};

const textFromValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  const item = record(value);
  const direct = firstString(item, [
    "name",
    "text",
    "simpleText",
    "title",
    "author_name",
  ]);
  if (direct) return direct;
  if (Array.isArray(item.runs)) {
    return item.runs
      .map((run) => firstString(record(run), ["text"]))
      .filter(Boolean)
      .join("")
      .trim();
  }
  return "";
};

export function authorFrom(
  item: Record<string, unknown>,
  platform?: Platform,
): { name: string; handle: string } {
  const coreUser = record(record(record(item.core).user_results).result);
  const containers = [
    record(item.user_info),
    record(item.userInfo),
    record(item.user),
    record(item.author_info),
    record(item.authorInfo),
    record(item.channel),
    record(item.owner),
    record(item.author),
    coreUser,
    record(coreUser.legacy),
  ];
  const directAuthor = textFromValue(item.author);
  const directName = firstString(item, [
    "author_name",
    "channel_name",
    "owner_name",
  ]);
  let name = directName || directAuthor;
  let handle = firstString(item, [
    "screen_name",
    "channel_handle",
    "author_handle",
    "handle",
    "username",
  ]);

  for (const container of containers) {
    if (!name) {
      name =
        firstString(container, ["name", "title", "author_name"]) ||
        textFromValue(container);
    }
    if (!handle) {
      handle = firstString(container, [
        "screen_name",
        "channel_handle",
        "handle",
        "username",
      ]);
    }
  }
  if (!name && handle) name = handle.replace(/^@/, "");
  return {
    name:
      name ||
      (platform === "linuxdo"
        ? "Linux.do 社区"
        : platform === "idcflare"
          ? "IDCFlare 社区"
          : platform === "gitlab"
            ? "GitLab 官方"
            : "未知作者"),
    handle,
  };
}

const avatarBaseUrl = (platform?: Platform) =>
  platform === "linuxdo"
    ? "https://linux.do"
    : platform === "idcflare"
      ? "https://idcflare.com"
      : platform === "gitlab"
        ? "https://about.gitlab.com"
        : undefined;

const normalizeAvatarUrl = (
  value: string,
  platform?: Platform,
): string | undefined => {
  const trimmed = value.trim().replace(/&amp;/g, "&");
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  const expanded = trimmed.replace(/\{size\}/g, "96");
  try {
    const url = expanded.startsWith("//")
      ? new URL(`https:${expanded}`)
      : new URL(expanded, avatarBaseUrl(platform));
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.hostname === "pbs.twimg.com"
      ? url.href.replace(/_normal(?=\.[a-z0-9]+(?:\?|$))/i, "_200x200")
      : url.href;
  } catch {
    return undefined;
  }
};

const avatarUrlFromValue = (
  value: unknown,
  platform?: Platform,
  depth = 0,
): string | undefined => {
  if (depth > 3 || value === null || value === undefined) return undefined;
  if (typeof value === "string") return normalizeAvatarUrl(value, platform);
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const url = avatarUrlFromValue(candidate, platform, depth + 1);
      if (url) return url;
    }
    return undefined;
  }
  const item = record(value);
  for (const key of [
    "url",
    "src",
    "uri",
    "href",
    "profile_image_url_https",
    "profile_image_url",
    "avatar_url",
    "avatarUrl",
    "avatar_template",
    "discourse:avatar",
  ]) {
    const candidate = item[key];
    if (typeof candidate !== "string") continue;
    const url = normalizeAvatarUrl(candidate, platform);
    if (url) return url;
  }
  for (const key of ["thumbnails", "thumbnail", "images", "image"]) {
    const url = avatarUrlFromValue(item[key], platform, depth + 1);
    if (url) return url;
  }
  return undefined;
};

export function avatarFrom(
  item: Record<string, unknown>,
  platform?: Platform,
): string | undefined {
  const coreUser = record(record(record(item.core).user_results).result);
  const author = record(item.author);
  const channel = record(item.channel);
  const containers = [
    record(item.user_info),
    record(item.userInfo),
    record(item.user),
    record(item.author_info),
    record(item.authorInfo),
    author,
    channel,
    record(item.owner),
    coreUser,
    record(coreUser.legacy),
  ];

  for (const key of [
    "author_avatar_url",
    "authorAvatarUrl",
    "author_avatar",
    "authorThumbnail",
    "author_thumbnail",
    "channel_avatar_url",
    "channelAvatarUrl",
    "channel_thumbnail",
    "channelThumbnail",
    "profile_image_url_https",
    "profile_image_url",
    "avatar_url",
    "avatarUrl",
    "avatar_template",
    "discourse:avatar",
  ]) {
    const url = avatarUrlFromValue(item[key], platform);
    if (url) return url;
  }

  for (const container of containers) {
    for (const key of [
      "profile_image_url_https",
      "profile_image_url",
      "avatar_url",
      "avatarUrl",
      "avatar",
      "avatar_template",
      "profile_picture",
      "profilePicture",
      "thumbnail",
      "thumbnails",
      "image",
      "images",
    ]) {
      const url = avatarUrlFromValue(container[key], platform);
      if (url) return url;
    }
  }
  return undefined;
}

export function collectCandidateObjects(
  root: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  max = 60,
): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<object>();

  while (queue.length && found.length < max) {
    const current = queue.shift()!;
    if (current.depth > 8 || current.value === null) continue;
    if (typeof current.value !== "object") continue;
    if (seen.has(current.value as object)) continue;
    seen.add(current.value as object);

    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    const item = current.value as Record<string, unknown>;
    if (predicate(item)) found.push(item);
    for (const child of Object.values(item)) {
      if (child && typeof child === "object") {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return found;
}

export const metricsFrom = (item: Record<string, unknown>): ContentMetrics => {
  const legacy = record(item.legacy);
  const user = {
    ...record(item.user_info),
    ...record(item.userInfo),
    ...record(item.user),
  };
  const stats = {
    ...item,
    ...record(item.statistics),
    ...record(item.stats),
    ...legacy,
  };
  return {
    views: firstNumber(stats, [
      "view_count",
      "views",
      "viewCount",
      "play_count",
      "view_count_text",
    ]),
    likes: firstNumber(stats, [
      "favorite_count",
      "like_count",
      "likes",
      "likeCount",
      "favorites",
    ]),
    replies: firstNumber(stats, ["reply_count", "replies", "replyCount"]),
    comments: firstNumber(stats, ["comment_count", "comments", "commentCount"]),
    shares: firstNumber(stats, ["share_count", "shares"]),
    reposts: firstNumber(stats, [
      "retweet_count",
      "repost_count",
      "reposts",
      "retweets",
    ]),
    quotes: firstNumber(stats, ["quote_count", "quotes"]),
    bookmarks: firstNumber(stats, ["bookmark_count", "bookmarks"]),
    authorFollowers: firstNumber(user, [
      "followers_count",
      "followers",
      "subscriber_count",
      "subscribers",
    ]),
  };
};

export const normalizeDate = (
  value: unknown,
  referenceAt: string | number | Date = new Date(),
): string => {
  const reference = new Date(referenceAt).getTime();
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1_000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (/^\d{10,13}$/.test(trimmed) && Number.isFinite(numeric)) {
      return normalizeDate(numeric);
    }
    const relative = trimmed
      .toLowerCase()
      .replace(/^(streamed|premiered)\s+/, "");
    const relativeMatch = relative.match(
      /(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week|month|year)s?\s+ago/,
    );
    const chineseMatch = trimmed.match(
      /(\d+(?:\.\d+)?)\s*(秒|分钟|小時|小时|天|周|週|个月|個月|月|年)前/,
    );
    if (relativeMatch || chineseMatch) {
      const amount = Number((relativeMatch ?? chineseMatch)![1]);
      const unit = (relativeMatch ?? chineseMatch)![2];
      const hours =
        /second|秒/.test(unit)
          ? amount / 3_600
          : /minute|分钟/.test(unit)
            ? amount / 60
            : /hour|小時|小时/.test(unit)
              ? amount
              : /day|天/.test(unit)
                ? amount * 24
                : /week|周|週/.test(unit)
                  ? amount * 24 * 7
                  : /month|个月|個月|月/.test(unit)
                    ? amount * 24 * 30
                    : amount * 24 * 365;
      return new Date(reference - hours * 3_600_000).toISOString();
    }
    if (relative === "yesterday") {
      return new Date(reference - 24 * 3_600_000).toISOString();
    }
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
};

export const platformLabel = (platform: Platform) =>
  platform === "x"
    ? "X"
    : platform === "youtube"
      ? "YouTube"
      : platform === "linuxdo"
        ? "Linux.do"
        : platform === "idcflare"
          ? "IDCFlare"
          : "GitLab";

export const stripHtml = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

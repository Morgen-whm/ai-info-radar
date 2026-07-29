import type { Platform, Source, SourceKind } from "./types";

export interface SourceCollectionConfig {
  maxPages: number;
  maxItems: number;
  searchType: "Latest" | "Top";
  timeRange:
    | "last_hour"
    | "today"
    | "this_week"
    | "this_month"
    | "this_year";
  sortBy: "relevance" | "upload_date" | "view_count" | "rating";
  languageCode: string;
  countryCode: string;
  filterKeywords: string;
  minValueScore: number;
}

const timeRanges = new Set<SourceCollectionConfig["timeRange"]>([
  "last_hour",
  "today",
  "this_week",
  "this_month",
  "this_year",
]);
const sortOptions = new Set<SourceCollectionConfig["sortBy"]>([
  "relevance",
  "upload_date",
  "view_count",
  "rating",
]);

const toInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.round(parsed)))
    : fallback;
};

const toCode = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z-]/g, "");
  return normalized.slice(0, 12) || fallback;
};

export function getSourceCollectionConfig(
  source: Pick<Source, "platform" | "kind" | "config">,
): SourceCollectionConfig {
  const input = source.config ?? {};
  const isPublicFeed =
    source.platform === "linuxdo" ||
    source.platform === "idcflare" ||
    source.platform === "gitlab";
  const supportsPages =
    !isPublicFeed &&
    source.kind !== "trending" &&
    source.kind !== "feed";
  const searchType = input.searchType === "Top" ? "Top" : "Latest";
  const timeRange = timeRanges.has(
    input.timeRange as SourceCollectionConfig["timeRange"],
  )
    ? (input.timeRange as SourceCollectionConfig["timeRange"])
    : "today";
  const sortBy = sortOptions.has(
    input.sortBy as SourceCollectionConfig["sortBy"],
  )
    ? (input.sortBy as SourceCollectionConfig["sortBy"])
    : "upload_date";

  return {
    maxPages: supportsPages
      ? toInteger(input.maxPages, 2, 1, 3)
      : 1,
    maxItems: toInteger(
      input.maxItems,
      isPublicFeed ? 50 : 100,
      10,
      150,
    ),
    searchType,
    timeRange,
    sortBy,
    languageCode: toCode(input.languageCode, "en"),
    countryCode: toCode(input.countryCode, "us"),
    filterKeywords:
      typeof input.filterKeywords === "string"
        ? input.filterKeywords.trim().slice(0, 500)
        : "",
    minValueScore: toInteger(input.minValueScore, 42, 0, 80),
  };
}

export function sanitizeSourceConfig(
  value: unknown,
  platform: Platform,
  kind: SourceKind,
): Record<string, string | number | boolean> {
  const config =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string | number | boolean>)
      : {};
  const normalized = getSourceCollectionConfig({ platform, kind, config });

  if (
    platform === "linuxdo" ||
    platform === "idcflare" ||
    platform === "gitlab"
  ) {
    return {
      maxItems: normalized.maxItems,
      filterKeywords: normalized.filterKeywords,
      minValueScore: normalized.minValueScore,
    };
  }
  if (platform === "x") {
    return {
      maxPages: normalized.maxPages,
      maxItems: normalized.maxItems,
      searchType: normalized.searchType,
      minValueScore: normalized.minValueScore,
    };
  }
  return {
    maxPages: normalized.maxPages,
    maxItems: normalized.maxItems,
    timeRange: normalized.timeRange,
    sortBy: normalized.sortBy,
    languageCode: normalized.languageCode,
    countryCode: normalized.countryCode,
    minValueScore: normalized.minValueScore,
  };
}

import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("healthy"),
    lastSyncedAt: text("last_synced_at"),
    itemCount: integer("item_count").notNull().default(0),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("sources_platform_idx").on(table.platform),
    index("sources_enabled_idx").on(table.enabled),
  ],
);

export const contents = sqliteTable(
  "contents",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    sourceId: text("source_id").notNull(),
    contentType: text("content_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    url: text("url").notNull(),
    authorName: text("author_name").notNull().default(""),
    authorHandle: text("author_handle"),
    authorAvatarUrl: text("author_avatar_url"),
    publishedAt: text("published_at").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    metricsJson: text("metrics_json").notNull().default("{}"),
    hotScore: real("hot_score").notNull().default(0),
    tagsJson: text("tags_json").notNull().default("[]"),
    aiSummary: text("ai_summary"),
    summaryStatus: text("summary_status").notNull().default("pending"),
    rawJson: text("raw_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("contents_platform_external_idx").on(
      table.platform,
      table.externalId,
    ),
    index("contents_published_idx").on(table.publishedAt),
    index("contents_hot_score_idx").on(table.hotScore),
    index("contents_source_idx").on(table.sourceId),
  ],
);

export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    capturedAt: text("captured_at").notNull(),
    metricsJson: text("metrics_json").notNull(),
    hotScore: real("hot_score").notNull(),
  },
  (table) => [
    index("snapshots_content_time_idx").on(table.contentId, table.capturedAt),
  ],
);

export const collectionJobs = sqliteTable(
  "collection_jobs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull(),
    itemsFound: integer("items_found").notNull().default(0),
    itemsAdded: integer("items_added").notNull().default(0),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    requestId: text("request_id"),
    billable: integer("billable", { mode: "boolean" }).notNull().default(false),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("jobs_started_idx").on(table.startedAt),
    index("jobs_status_idx").on(table.status),
  ],
);

export const appMigrations = sqliteTable("app_migrations", {
  id: text("id").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

export const apiUsageDaily = sqliteTable(
  "api_usage_daily",
  {
    date: text("date").notNull(),
    provider: text("provider").notNull(),
    route: text("route").notNull(),
    requests: integer("requests").notNull().default(0),
    successes: integer("successes").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  },
  (table) => [
    uniqueIndex("usage_day_route_idx").on(
      table.date,
      table.provider,
      table.route,
    ),
  ],
);

export const weeklyReports = sqliteTable(
  "weekly_reports",
  {
    id: text("id").primaryKey(),
    weekStart: text("week_start").notNull(),
    weekEnd: text("week_end").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    status: text("status").notNull().default("generating"),
    overview: text("overview").notNull().default(""),
    contentHash: text("content_hash"),
    itemCount: integer("item_count").notNull().default(0),
    statsJson: text("stats_json").notNull().default("{}"),
    generatedAt: text("generated_at"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("weekly_reports_period_idx").on(table.weekStart, table.weekEnd),
    index("weekly_reports_status_idx").on(table.status),
    index("weekly_reports_generated_idx").on(table.generatedAt),
  ],
);

export const weeklyReportItems = sqliteTable(
  "weekly_report_items",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id").notNull(),
    contentId: text("content_id").notNull(),
    rank: integer("rank").notNull(),
    category: text("category").notNull(),
    score: real("score").notNull(),
    itemJson: text("item_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("weekly_report_items_report_rank_idx").on(
      table.reportId,
      table.rank,
    ),
    index("weekly_report_items_content_idx").on(table.contentId),
  ],
);

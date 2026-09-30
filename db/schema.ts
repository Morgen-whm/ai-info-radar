import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const wechatDrafts = sqliteTable("wechat_drafts", {
  contentId: text("content_id").primaryKey(),
  dataJson: text("data_json").notNull().default("{}"),
  version: integer("version").notNull().default(0),
  operation: text("operation").notNull().default(""),
  operationToken: text("operation_token").notNull().default(""),
  operationStartedAt: text("operation_started_at"),
  updatedAt: text("updated_at").notNull(),
});
export const wechatSyncLogs = sqliteTable("wechat_sync_logs", {
  id: text("id").primaryKey(), contentId: text("content_id").notNull(),
  status: text("status").notNull(), message: text("message").notNull(),
  mediaId: text("media_id").notNull().default(""), createdAt: text("created_at").notNull(),
}, (table) => [index("wechat_logs_content_time_idx").on(table.contentId, table.createdAt)]);
export const wechatAssets = sqliteTable("wechat_assets", {
  id: text("id").primaryKey(), mime: text("mime").notNull(),
  dataBase64: text("data_base64").notNull(), createdAt: text("created_at").notNull(),
});

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

export const githubStarSnapshots = sqliteTable(
  "github_star_snapshots",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id").notNull(),
    fullName: text("full_name").notNull(),
    stars: integer("stars").notNull().default(0),
    forks: integer("forks").notNull().default(0),
    capturedDate: text("captured_date").notNull(),
    capturedAt: text("captured_at").notNull(),
    repositoryJson: text("repository_json").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("github_snapshots_repo_date_idx").on(
      table.repositoryId,
      table.capturedDate,
    ),
    index("github_snapshots_date_stars_idx").on(
      table.capturedDate,
      table.stars,
    ),
    index("github_snapshots_name_idx").on(table.fullName),
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

export const rewriteJobs = sqliteTable(
  "rewrite_jobs",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message").notNull().default("等待开始"),
    profileId: text("profile_id").notNull(),
    profileVersion: text("profile_version").notNull(),
    template: text("template").notNull().default("knowledge_card"),
    knowledgeCategory: text("knowledge_category")
      .notNull()
      .default("overseas_practice"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("rewrite_jobs_content_idx").on(table.contentId),
    index("rewrite_jobs_status_updated_idx").on(table.status, table.updatedAt),
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

export const rewriteCandidates = sqliteTable(
  "rewrite_candidates",
  {
    contentId: text("content_id").primaryKey(),
    addedAt: text("added_at").notNull(),
  },
  (table) => [index("rewrite_candidates_added_idx").on(table.addedAt)],
);

export const reviewInboxLinks = sqliteTable(
  "review_inbox_links",
  {
    contentId: text("content_id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    platform: text("platform").notNull(),
    authorName: text("author_name").notNull().default(""),
    addedAt: text("added_at").notNull(),
  },
  (table) => [index("review_inbox_links_added_idx").on(table.addedAt)],
);

export const contentReviews = sqliteTable(
  "content_reviews",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    status: text("status").notNull().default("pending"),
    sourceTier: text("source_tier").notNull().default("B"),
    template: text("template").notNull().default("knowledge_card"),
    knowledgeCategory: text("knowledge_category")
      .notNull()
      .default("overseas_practice"),
    sourceSnapshotJson: text("source_snapshot_json").notNull().default("{}"),
    aiDraft: text("ai_draft").notNull().default(""),
    editorTitle: text("editor_title").notNull().default(""),
    editorContent: text("editor_content").notNull().default(""),
    editorNote: text("editor_note").notNull().default(""),
    reviewerName: text("reviewer_name").notNull().default(""),
    editorialPipelineJson: text("editorial_pipeline_json")
      .notNull()
      .default("{}"),
    reviewedAt: text("reviewed_at"),
    publicationStatus: text("publication_status").notNull().default("draft"),
    feishuDocumentId: text("feishu_document_id"),
    feishuWikiNodeToken: text("feishu_wiki_node_token"),
    feishuUrl: text("feishu_url"),
    publishedContentHash: text("published_content_hash"),
    publishedAt: text("published_at"),
    publishError: text("publish_error"),
    sitePublicationStatus: text("site_publication_status")
      .notNull()
      .default("draft"),
    knowledgeArticleId: text("knowledge_article_id"),
    siteUrl: text("site_url"),
    sitePublishedAt: text("site_published_at"),
    sitePublishError: text("site_publish_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("content_reviews_content_idx").on(table.contentId),
    index("content_reviews_status_idx").on(table.status),
    index("content_reviews_publication_idx").on(table.publicationStatus),
    index("content_reviews_site_publication_idx").on(
      table.sitePublicationStatus,
    ),
    index("content_reviews_updated_idx").on(table.updatedAt),
  ],
);

export const knowledgeArticles = sqliteTable(
  "knowledge_articles",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull(),
    sourceSnapshotJson: text("source_snapshot_json").notNull().default("{}"),
    tagsJson: text("tags_json").notNull().default("[]"),
    status: text("status").notNull().default("published"),
    publishedAt: text("published_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_articles_content_idx").on(table.contentId),
    uniqueIndex("knowledge_articles_slug_idx").on(table.slug),
    index("knowledge_articles_category_idx").on(table.category),
    index("knowledge_articles_status_date_idx").on(
      table.status,
      table.publishedAt,
    ),
  ],
);

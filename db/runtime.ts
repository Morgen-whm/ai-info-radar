export interface AppEnv {
  DB?: D1Database;
  ASSETS?: Fetcher;
  TIKHUB_BASE_URL?: string;
  TIKHUB_TOKEN?: string;
  TIKHUB_KEY_ENCRYPTION_SECRET?: string;
  RSS_PROXY_URL?: string;
  LINUXDO_PROXY_URL?: string;
  LINUXDO_SCHEDULE_MODE?: "direct" | "external";
  IDCFLARE_SCHEDULE_MODE?: "direct" | "external";
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  WECHAT_AUTHOR?: string;
  WECHAT_IMAGE_HOSTS?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_TOKEN?: string;
  DATA_MODE?: "demo" | "live";
  CRON_SECRET?: string;
  WEEKLY_API_KEY?: string;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_WIKI_SPACE_ID?: string;
  FEISHU_WIKI_PARENT_NODE_TOKEN?: string;
  FEISHU_FOLDER_TOKEN?: string;
  FEISHU_TENANT_DOMAIN?: string;
  FEISHU_DAILY_DOCUMENT_ID?: string;
  FEISHU_DAILY_WIKI_NODE_TOKEN?: string;
  FEISHU_DAILY_DOCUMENT_TITLE?: string;
}

export async function getAppEnv(): Promise<AppEnv> {
  try {
    const runtime = await import("cloudflare:workers");
    return runtime.env as unknown as AppEnv;
  } catch {
    return {
      DATA_MODE:
        process.env.DATA_MODE === "live" ? "live" : "demo",
      TIKHUB_BASE_URL: process.env.TIKHUB_BASE_URL,
      TIKHUB_TOKEN: process.env.TIKHUB_TOKEN,
      TIKHUB_KEY_ENCRYPTION_SECRET:
        process.env.TIKHUB_KEY_ENCRYPTION_SECRET,
      RSS_PROXY_URL: process.env.RSS_PROXY_URL,
      LINUXDO_PROXY_URL: process.env.LINUXDO_PROXY_URL,
      LINUXDO_SCHEDULE_MODE:
        process.env.LINUXDO_SCHEDULE_MODE === "external"
          ? "external"
          : "direct",
      IDCFLARE_SCHEDULE_MODE:
        process.env.IDCFLARE_SCHEDULE_MODE === "external"
          ? "external"
          : "direct",
      AI_BASE_URL: process.env.AI_BASE_URL,
      AI_API_KEY: process.env.AI_API_KEY,
      AI_MODEL: process.env.AI_MODEL,
      WECHAT_APP_ID: process.env.WECHAT_APP_ID,
      WECHAT_APP_SECRET: process.env.WECHAT_APP_SECRET,
      WECHAT_AUTHOR: process.env.WECHAT_AUTHOR,
      WECHAT_IMAGE_HOSTS: process.env.WECHAT_IMAGE_HOSTS,
      GITHUB_API_BASE_URL: process.env.GITHUB_API_BASE_URL,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      CRON_SECRET: process.env.CRON_SECRET,
      WEEKLY_API_KEY: process.env.WEEKLY_API_KEY,
      FEISHU_APP_ID: process.env.FEISHU_APP_ID,
      FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
      FEISHU_WIKI_SPACE_ID: process.env.FEISHU_WIKI_SPACE_ID,
      FEISHU_WIKI_PARENT_NODE_TOKEN:
        process.env.FEISHU_WIKI_PARENT_NODE_TOKEN,
      FEISHU_FOLDER_TOKEN: process.env.FEISHU_FOLDER_TOKEN,
      FEISHU_TENANT_DOMAIN: process.env.FEISHU_TENANT_DOMAIN,
      FEISHU_DAILY_DOCUMENT_ID: process.env.FEISHU_DAILY_DOCUMENT_ID,
      FEISHU_DAILY_WIKI_NODE_TOKEN:
        process.env.FEISHU_DAILY_WIKI_NODE_TOKEN,
      FEISHU_DAILY_DOCUMENT_TITLE:
        process.env.FEISHU_DAILY_DOCUMENT_TITLE,
    };
  }
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS wechat_drafts (
    content_id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 0, operation TEXT NOT NULL DEFAULT '',
    operation_token TEXT NOT NULL DEFAULT '', operation_started_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wechat_sync_logs (
    id TEXT PRIMARY KEY, content_id TEXT NOT NULL, status TEXT NOT NULL,
    message TEXT NOT NULL, media_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS wechat_logs_content_time_idx ON wechat_sync_logs(content_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS wechat_assets (
    id TEXT PRIMARY KEY, mime TEXT NOT NULL, data_base64 TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 15,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'healthy',
    last_synced_at TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sources_platform_idx ON sources(platform)`,
  `CREATE INDEX IF NOT EXISTS sources_enabled_idx ON sources(enabled)`,
  `CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    author_handle TEXT,
    author_avatar_url TEXT,
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '{}',
    hot_score REAL NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    ai_summary TEXT,
    summary_status TEXT NOT NULL DEFAULT 'pending',
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS contents_platform_external_idx ON contents(platform, external_id)`,
  `CREATE INDEX IF NOT EXISTS contents_published_idx ON contents(published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS contents_hot_score_idx ON contents(hot_score DESC)`,
  `CREATE INDEX IF NOT EXISTS contents_source_idx ON contents(source_id)`,
  `CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    hot_score REAL NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_content_time_idx ON metric_snapshots(content_id, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS github_star_snapshots (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    forks INTEGER NOT NULL DEFAULT 0,
    captured_date TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    repository_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(repository_id, captured_date)
  )`,
  `CREATE INDEX IF NOT EXISTS github_snapshots_date_stars_idx ON github_star_snapshots(captured_date, stars DESC)`,
  `CREATE INDEX IF NOT EXISTS github_snapshots_name_idx ON github_star_snapshots(full_name)`,
  `CREATE TABLE IF NOT EXISTS collection_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    items_found INTEGER NOT NULL DEFAULT 0,
    items_added INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    request_id TEXT,
    billable INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_started_idx ON collection_jobs(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS jobs_status_idx ON collection_jobs(status)`,
  `CREATE TABLE IF NOT EXISTS rewrite_jobs (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '等待开始',
    profile_id TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    template TEXT NOT NULL DEFAULT 'knowledge_card',
    knowledge_category TEXT NOT NULL DEFAULT 'overseas_practice',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS rewrite_jobs_content_idx ON rewrite_jobs(content_id)`,
  `CREATE INDEX IF NOT EXISTS rewrite_jobs_status_updated_idx ON rewrite_jobs(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS app_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_usage_daily (
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    route TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    UNIQUE(date, provider, route)
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_reports (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    status TEXT NOT NULL DEFAULT 'generating',
    overview TEXT NOT NULL DEFAULT '',
    content_hash TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL DEFAULT '{}',
    generated_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS weekly_reports_period_idx ON weekly_reports(week_start, week_end)`,
  `CREATE INDEX IF NOT EXISTS weekly_reports_status_idx ON weekly_reports(status)`,
  `CREATE INDEX IF NOT EXISTS weekly_reports_generated_idx ON weekly_reports(generated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS weekly_report_items (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    category TEXT NOT NULL,
    score REAL NOT NULL,
    item_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(report_id, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS weekly_report_items_content_idx ON weekly_report_items(content_id)`,
  `CREATE TABLE IF NOT EXISTS rewrite_candidates (
    content_id TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rewrite_candidates_added_idx ON rewrite_candidates(added_at DESC)`,
  `CREATE TABLE IF NOT EXISTS review_inbox_links (
    content_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS review_inbox_links_added_idx ON review_inbox_links(added_at DESC)`,
  `CREATE TABLE IF NOT EXISTS content_reviews (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    source_tier TEXT NOT NULL DEFAULT 'B',
    template TEXT NOT NULL DEFAULT 'knowledge_card',
    knowledge_category TEXT NOT NULL DEFAULT 'overseas_practice',
    source_snapshot_json TEXT NOT NULL DEFAULT '{}',
    ai_draft TEXT NOT NULL DEFAULT '',
    editor_title TEXT NOT NULL DEFAULT '',
    editor_content TEXT NOT NULL DEFAULT '',
    editor_note TEXT NOT NULL DEFAULT '',
    reviewer_name TEXT NOT NULL DEFAULT '',
    editorial_pipeline_json TEXT NOT NULL DEFAULT '{}',
    reviewed_at TEXT,
    publication_status TEXT NOT NULL DEFAULT 'draft',
    feishu_document_id TEXT,
    feishu_wiki_node_token TEXT,
    feishu_url TEXT,
    published_content_hash TEXT,
    published_at TEXT,
    publish_error TEXT,
    site_publication_status TEXT NOT NULL DEFAULT 'draft',
    knowledge_article_id TEXT,
    site_url TEXT,
    site_published_at TEXT,
    site_publish_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS content_reviews_content_idx ON content_reviews(content_id)`,
  `CREATE INDEX IF NOT EXISTS content_reviews_status_idx ON content_reviews(status)`,
  `CREATE INDEX IF NOT EXISTS content_reviews_publication_idx ON content_reviews(publication_status)`,
  `CREATE INDEX IF NOT EXISTS content_reviews_updated_idx ON content_reviews(updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS knowledge_articles (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    body_markdown TEXT NOT NULL,
    source_snapshot_json TEXT NOT NULL DEFAULT '{}',
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'published',
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_articles_content_idx ON knowledge_articles(content_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_articles_slug_idx ON knowledge_articles(slug)`,
  `CREATE INDEX IF NOT EXISTS knowledge_articles_category_idx ON knowledge_articles(category)`,
  `CREATE INDEX IF NOT EXISTS knowledge_articles_status_date_idx ON knowledge_articles(status, published_at DESC)`,
];

let schemaReady = false;

export async function ensureDatabase(db: D1Database): Promise<void> {
  if (schemaReady) return;
  const statements = schemaStatements.map((sql) => db.prepare(sql));
  await db.batch(statements);
  const contentColumns = await db
    .prepare("PRAGMA table_info(contents)")
    .all<{ name: string }>();
  if (
    !contentColumns.results.some(
      (column) => column.name === "author_avatar_url",
    )
  ) {
    await db
      .prepare("ALTER TABLE contents ADD COLUMN author_avatar_url TEXT")
      .run();
  }
  const reviewColumns = await db
    .prepare("PRAGMA table_info(content_reviews)")
    .all<{ name: string }>();
  const reviewColumnNames = new Set(
    reviewColumns.results.map((column) => column.name),
  );
  const missingReviewColumns = [
    ["knowledge_category", "TEXT NOT NULL DEFAULT 'overseas_practice'"],
    ["site_publication_status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["knowledge_article_id", "TEXT"],
    ["site_url", "TEXT"],
    ["site_published_at", "TEXT"],
    ["site_publish_error", "TEXT"],
    ["editorial_pipeline_json", "TEXT NOT NULL DEFAULT '{}'"],
  ] as const;
  for (const [name, definition] of missingReviewColumns) {
    if (!reviewColumnNames.has(name)) {
      await db
        .prepare(`ALTER TABLE content_reviews ADD COLUMN ${name} ${definition}`)
        .run();
    }
  }
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS content_reviews_site_publication_idx ON content_reviews(site_publication_status)",
    )
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO rewrite_candidates (content_id, added_at)
       SELECT content_id, created_at FROM content_reviews`,
    )
    .run();
  schemaReady = true;
}

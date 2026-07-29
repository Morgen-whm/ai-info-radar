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
  DATA_MODE?: "demo" | "live";
  CRON_SECRET?: string;
  WEEKLY_API_KEY?: string;
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
      CRON_SECRET: process.env.CRON_SECRET,
      WEEKLY_API_KEY: process.env.WEEKLY_API_KEY,
    };
  }
}

const schemaStatements = [
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
];

let schemaReady = false;

export async function ensureDatabase(db: D1Database): Promise<void> {
  if (schemaReady) return;
  const statements = schemaStatements.map((sql) => db.prepare(sql));
  await db.batch(statements);
  schemaReady = true;
}

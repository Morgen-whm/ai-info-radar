import { demoSources } from "@/lib/demo-data";
import type {
  CollectionJob,
  ContentItem,
  NormalizedContentInput,
  Platform,
  Source,
  SourceKind,
  WeeklyReport,
  WeeklyReportStats,
  WeeklyReportStatus,
  WeeklyReportStatusResult,
  WeeklyReportTopic,
} from "@/lib/types";
import {
  calculateContentValueScore,
  recommendationScore,
} from "@/lib/content-value";
import {
  authorFrom,
  firstString,
  metricsFrom,
  normalizeDate,
  record,
} from "@/lib/connectors/helpers";
import { ensureDatabase, getAppEnv } from "./runtime";

type Row = Record<string, unknown>;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const sourceFromRow = (row: Row): Source => ({
  id: String(row.id),
  name: String(row.name),
  platform: String(row.platform) as Platform,
  kind: String(row.kind) as SourceKind,
  target: String(row.target),
  intervalMinutes: Number(row.interval_minutes),
  enabled: Boolean(row.enabled),
  status: String(row.status) as Source["status"],
  lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
  itemCount: Number(row.item_count ?? 0),
  config: parseJson<Record<string, string | number | boolean>>(
    row.config_json,
    {},
  ),
});

const contentFromRow = (row: Row): ContentItem => {
  const platform = String(row.platform) as Platform;
  const raw = record(parseJson<Record<string, unknown>>(row.raw_json, {}));
  const storedAuthor = String(row.author_name ?? "");
  const recoveredAuthor = authorFrom(raw, platform);
  const authorName =
    storedAuthor && storedAuthor !== "未知作者"
      ? storedAuthor
      : recoveredAuthor.name;
  const authorHandle = row.author_handle
    ? String(row.author_handle)
    : recoveredAuthor.handle
      ? `@${recoveredAuthor.handle.replace(/^@/, "")}`
      : undefined;
  const storedMetrics = parseJson(row.metrics_json, {});
  const metrics = { ...metricsFrom(raw), ...storedMetrics };
  const fetchedAt = String(row.fetched_at);
  const rawPublished =
    platform === "youtube"
      ? raw.published_at ??
        raw.publish_date ??
        raw.published_time ??
        raw.publishedTime ??
        raw.publishedTimeText
      : undefined;
  const publishedAt = rawPublished
    ? normalizeDate(rawPublished, fetchedAt)
    : String(row.published_at);
  const item = {
    id: String(row.id),
    externalId: String(row.external_id),
    platform,
    sourceId: String(row.source_id),
    type: String(row.content_type) as ContentItem["type"],
    title: String(row.title),
    body:
      String(row.body ?? "") ||
      firstString(raw, [
        "description",
        "description_snippet",
        "short_description",
        "snippet",
      ]),
    url: String(row.url),
    authorName,
    authorHandle,
    publishedAt,
    fetchedAt,
    metrics,
    hotScore: 0,
    tags: parseJson<string[]>(row.tags_json, []),
    aiSummary: row.ai_summary ? String(row.ai_summary) : undefined,
    summaryStatus: String(row.summary_status) as ContentItem["summaryStatus"],
    sourceName: row.source_name ? String(row.source_name) : undefined,
    sourceTarget: row.source_target ? String(row.source_target) : undefined,
  } satisfies ContentItem;
  item.hotScore = calculateContentValueScore(item);
  return item;
};

const jobFromRow = (row: Row): CollectionJob => ({
  id: String(row.id),
  sourceId: String(row.source_id),
  sourceName: String(row.source_name),
  platform: String(row.platform) as Platform,
  status: String(row.status) as CollectionJob["status"],
  itemsFound: Number(row.items_found ?? 0),
  itemsAdded: Number(row.items_added ?? 0),
  durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  errorMessage: row.error_message ? String(row.error_message) : undefined,
  startedAt: String(row.started_at),
  completedAt: row.completed_at ? String(row.completed_at) : null,
});

export async function getDatabase(): Promise<D1Database> {
  const db = (await getAppEnv()).DB;
  if (!db) throw new Error("D1 数据库绑定不可用");
  return db;
}

export async function seedDefaultSources(db: D1Database): Promise<void> {
  await ensureDatabase(db);
  const result = await db.prepare("SELECT COUNT(*) AS count FROM sources").first<{
    count: number;
  }>();
  const now = new Date().toISOString();
  const existingCount = Number(result?.count ?? 0);
  const defaultSourceMigrations = [
    {
      id: "default-source-idcflare-daily-top-v1",
      sourceIds: ["src-idcflare-daily-top"],
    },
    {
      id: "default-sources-gitlab-official-v1",
      sourceIds: [
        "src-gitlab-blog",
        "src-gitlab-releases",
        "src-gitlab-patches",
      ],
    },
  ];
  const appliedMigrationIds = new Set<string>();
  for (const migration of defaultSourceMigrations) {
    const applied = await db
      .prepare("SELECT id FROM app_migrations WHERE id = ?")
      .bind(migration.id)
      .first<{ id: string }>();
    if (applied) appliedMigrationIds.add(migration.id);
  }
  const missingMigrations = defaultSourceMigrations.filter(
    (migration) => !appliedMigrationIds.has(migration.id),
  );
  if (existingCount > 0 && !missingMigrations.length) return;

  const sourceIdsToSeed = new Set(
    missingMigrations.flatMap((migration) => migration.sourceIds),
  );
  const sourcesToSeed =
    existingCount === 0
      ? demoSources
      : demoSources.filter((source) => sourceIdsToSeed.has(source.id));
  await db.batch([
    ...sourcesToSeed.map((source) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO sources (
            id, name, platform, kind, target, interval_minutes, enabled,
            status, last_synced_at, item_count, config_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.id,
          source.name,
          source.platform,
          source.kind,
          source.target,
          source.intervalMinutes,
          source.enabled ? 1 : 0,
          source.status,
          null,
          0,
          JSON.stringify(source.config ?? {}),
          now,
          now,
        ),
    ),
    ...missingMigrations.map((migration) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO app_migrations (id, applied_at) VALUES (?, ?)",
        )
        .bind(migration.id, now),
    ),
  ]);
}

export async function listSources(): Promise<Source[]> {
  const db = await getDatabase();
  await seedDefaultSources(db);
  const result = await db
    .prepare("SELECT * FROM sources ORDER BY enabled DESC, created_at ASC")
    .all<Row>();
  return result.results.map(sourceFromRow);
}

export async function getSource(id: string): Promise<Source | null> {
  const db = await getDatabase();
  await seedDefaultSources(db);
  const row = await db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id)
    .first<Row>();
  return row ? sourceFromRow(row) : null;
}

export async function createSource(
  input: Pick<
    Source,
    "name" | "platform" | "kind" | "target" | "intervalMinutes" | "config"
  >,
): Promise<Source> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const id = `src-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sources (
        id, name, platform, kind, target, interval_minutes, enabled,
        status, item_count, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'healthy', 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.platform,
      input.kind,
      input.target,
      input.intervalMinutes,
      JSON.stringify(input.config ?? {}),
      now,
      now,
    )
    .run();
  return (await getSource(id))!;
}

export async function updateSource(
  id: string,
  input: Partial<
    Pick<
      Source,
      "name" | "target" | "intervalMinutes" | "enabled" | "config"
    >
  >,
): Promise<Source | null> {
  const existing = await getSource(id);
  if (!existing) return null;
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sources
       SET name = ?, target = ?, interval_minutes = ?, enabled = ?,
           config_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      input.target ?? existing.target,
      input.intervalMinutes ?? existing.intervalMinutes,
      (input.enabled ?? existing.enabled) ? 1 : 0,
      JSON.stringify(input.config ?? existing.config ?? {}),
      now,
      id,
    )
    .run();
  return getSource(id);
}

export async function deleteSource(id: string): Promise<boolean> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare("DELETE FROM sources WHERE id = ?")
    .bind(id)
    .run();
  return Boolean(result.meta.changes);
}

export async function listContents(limit = 50): Promise<ContentItem[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare(
      `SELECT c.*, s.name AS source_name, s.target AS source_target
       FROM contents c
       LEFT JOIN sources s ON s.id = c.source_id
       ORDER BY c.published_at DESC, c.hot_score DESC
       LIMIT ?`,
    )
    .bind(Math.min(500, Math.max(1, limit)))
    .all<Row>();
  return result.results.map(contentFromRow);
}

export async function listContentsByPeriod(
  start: string,
  end: string,
  limit = 2_000,
): Promise<ContentItem[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare(
      `SELECT c.*, s.name AS source_name, s.target AS source_target
       FROM contents c
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE c.published_at >= ? AND c.published_at < ?
       ORDER BY c.published_at DESC, c.hot_score DESC
       LIMIT ?`,
    )
    .bind(start, end, Math.min(5_000, Math.max(1, limit)))
    .all<Row>();
  return result.results.map((row) => {
    const item = contentFromRow(row);
    // Weekly selection must retain the value measured when the item was
    // collected instead of penalizing an early-week story again on Monday.
    item.hotScore = Math.max(item.hotScore, Number(row.hot_score ?? 0));
    return item;
  });
}

export async function listRecommendedContents(
  limit = 50,
): Promise<ContentItem[]> {
  const items = await listContents(500);
  return items
    .sort((a, b) => recommendationScore(b) - recommendationScore(a))
    .slice(0, Math.min(500, Math.max(1, limit)));
}

export async function getContentStats(): Promise<{
  total: number;
  contents24h: number;
  platformCounts: Record<Platform, number>;
}> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [totals, groups] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS contents_24h
         FROM contents`,
      )
      .bind(cutoff)
      .first<Row>(),
    db
      .prepare("SELECT platform, COUNT(*) AS count FROM contents GROUP BY platform")
      .all<Row>(),
  ]);
  const platformCounts: Record<Platform, number> = {
    x: 0,
    youtube: 0,
    linuxdo: 0,
    idcflare: 0,
    gitlab: 0,
  };
  for (const row of groups.results) {
    const platform = String(row.platform) as Platform;
    if (platform in platformCounts) {
      platformCounts[platform] = Number(row.count ?? 0);
    }
  }
  return {
    total: Number(totals?.total ?? 0),
    contents24h: Number(totals?.contents_24h ?? 0),
    platformCounts,
  };
}

export async function upsertContent(
  sourceId: string,
  item: NormalizedContentInput,
  aiSummary?: string,
): Promise<boolean> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const existing = await db
    .prepare("SELECT id, metrics_json FROM contents WHERE platform = ? AND external_id = ?")
    .bind(item.platform, item.externalId)
    .first<Row>();
  const now = new Date().toISOString();
  const score = calculateContentValueScore({
    platform: item.platform,
    title: item.title,
    body: item.body,
    url: item.url,
    authorName: item.authorName,
    metrics: item.metrics,
    publishedAt: item.publishedAt,
  });
  const id = existing ? String(existing.id) : `cnt-${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO contents (
        id, platform, external_id, source_id, content_type, title, body, url,
        author_name, author_handle, published_at, fetched_at, metrics_json,
        hot_score, tags_json, ai_summary, summary_status, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET
        source_id = excluded.source_id,
        title = excluded.title,
        body = excluded.body,
        url = excluded.url,
        author_name = excluded.author_name,
        author_handle = excluded.author_handle,
        fetched_at = excluded.fetched_at,
        metrics_json = excluded.metrics_json,
        hot_score = excluded.hot_score,
        tags_json = excluded.tags_json,
        ai_summary = COALESCE(excluded.ai_summary, contents.ai_summary),
        summary_status = excluded.summary_status,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      item.platform,
      item.externalId,
      sourceId,
      item.type,
      item.title,
      item.body,
      item.url,
      item.authorName,
      item.authorHandle ?? null,
      item.publishedAt,
      item.fetchedAt,
      JSON.stringify(item.metrics),
      score,
      JSON.stringify(item.tags),
      aiSummary ?? null,
      aiSummary ? "ready" : "pending",
      JSON.stringify(item.raw),
      now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO metric_snapshots
       (id, content_id, captured_at, metrics_json, hot_score)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      `snap-${crypto.randomUUID()}`,
      id,
      item.fetchedAt,
      JSON.stringify(item.metrics),
      score,
    )
    .run();
  return !existing;
}

export async function createJob(source: Source): Promise<CollectionJob> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const job: CollectionJob = {
    id: `job-${crypto.randomUUID()}`,
    sourceId: source.id,
    sourceName: source.name,
    platform: source.platform,
    status: "running",
    itemsFound: 0,
    itemsAdded: 0,
    durationMs: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  await db
    .prepare(
      `INSERT INTO collection_jobs (
        id, source_id, source_name, platform, status, items_found,
        items_added, started_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
    )
    .bind(
      job.id,
      job.sourceId,
      job.sourceName,
      job.platform,
      job.status,
      job.startedAt,
    )
    .run();
  return job;
}

export async function finishJob(
  jobId: string,
  values: {
    status: "succeeded" | "failed";
    itemsFound: number;
    itemsAdded: number;
    durationMs: number;
    errorMessage?: string;
    requestId?: string;
    billable?: boolean;
  },
): Promise<void> {
  const db = await getDatabase();
  const completedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE collection_jobs
       SET status = ?, items_found = ?, items_added = ?, duration_ms = ?,
           error_message = ?, request_id = ?, billable = ?, completed_at = ?
       WHERE id = ?`,
    )
    .bind(
      values.status,
      values.itemsFound,
      values.itemsAdded,
      values.durationMs,
      values.errorMessage ?? null,
      values.requestId ?? null,
      values.billable ? 1 : 0,
      completedAt,
      jobId,
    )
    .run();
}

export async function markSourceSynced(
  sourceId: string,
  added: number,
  status: Source["status"] = "healthy",
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sources
       SET last_synced_at = ?, item_count = item_count + ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, added, status, now, sourceId)
    .run();
}

export async function listJobs(limit = 30): Promise<CollectionJob[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare("SELECT * FROM collection_jobs ORDER BY started_at DESC LIMIT ?")
    .bind(Math.min(100, Math.max(1, limit)))
    .all<Row>();
  return result.results.map(jobFromRow);
}

const emptyWeeklyStats = (): WeeklyReportStats => ({
  candidates: 0,
  selected: 0,
  platformCounts: {},
  categoryCounts: {},
});

const weeklyReportFromRow = (
  row: Row,
  topics: WeeklyReportTopic[],
): WeeklyReport => ({
  reportId: String(row.id),
  status: String(row.status) as WeeklyReportStatus,
  period: {
    start: String(row.week_start),
    end: String(row.week_end),
    timezone: "Asia/Shanghai",
  },
  generatedAt: row.generated_at ? String(row.generated_at) : null,
  overview: String(row.overview ?? ""),
  contentHash: row.content_hash ? String(row.content_hash) : null,
  stats: parseJson<WeeklyReportStats>(row.stats_json, emptyWeeklyStats()),
  topics,
  errorMessage: row.error_message ? String(row.error_message) : undefined,
});

async function loadWeeklyTopics(
  db: D1Database,
  reportId: string,
): Promise<WeeklyReportTopic[]> {
  const rows = await db
    .prepare(
      `SELECT item_json
       FROM weekly_report_items
       WHERE report_id = ?
       ORDER BY rank ASC`,
    )
    .bind(reportId)
    .all<Row>();
  return rows.results
    .map((row) => parseJson<WeeklyReportTopic | null>(row.item_json, null))
    .filter((topic): topic is WeeklyReportTopic => topic !== null);
}

export async function getWeeklyReport(
  reportId: string,
): Promise<WeeklyReport | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare("SELECT * FROM weekly_reports WHERE id = ?")
    .bind(reportId)
    .first<Row>();
  if (!row) return null;
  const topics = await loadWeeklyTopics(db, reportId);
  return weeklyReportFromRow(row, topics);
}

export async function getLatestWeeklyReport(): Promise<WeeklyReport | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare(
      `SELECT *
       FROM weekly_reports
       WHERE status = 'ready'
       ORDER BY week_end DESC, generated_at DESC
       LIMIT 1`,
    )
    .first<Row>();
  if (!row) return null;
  const reportId = String(row.id);
  return weeklyReportFromRow(row, await loadWeeklyTopics(db, reportId));
}

export async function getWeeklyReportStatus(
  reportId: string,
): Promise<WeeklyReportStatusResult | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare(
      `SELECT id, week_start, week_end, timezone, status, generated_at,
              item_count, error_message
       FROM weekly_reports
       WHERE id = ?`,
    )
    .bind(reportId)
    .first<Row>();
  if (!row) return null;
  return {
    reportId: String(row.id),
    status: String(row.status) as WeeklyReportStatus,
    period: {
      start: String(row.week_start),
      end: String(row.week_end),
      timezone: "Asia/Shanghai",
    },
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    itemCount: Number(row.item_count ?? 0),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
  };
}

export async function beginWeeklyReport(
  reportId: string,
  start: string,
  end: string,
): Promise<void> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO weekly_reports (
        id, week_start, week_end, timezone, status, overview, item_count,
        stats_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'Asia/Shanghai', 'generating', '', 0, '{}', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         week_start = excluded.week_start,
         week_end = excluded.week_end,
         status = 'generating',
         error_message = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(reportId, start, end, now, now)
    .run();
}

export async function completeWeeklyReport(
  report: WeeklyReport,
): Promise<void> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare("DELETE FROM weekly_report_items WHERE report_id = ?")
      .bind(report.reportId),
    ...report.topics.map((topic) =>
      db
        .prepare(
          `INSERT INTO weekly_report_items (
            id, report_id, content_id, rank, category, score, item_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `${report.reportId}-item-${topic.rank}`,
          report.reportId,
          topic.sources[0]?.contentId ?? topic.id,
          topic.rank,
          topic.category,
          topic.score,
          JSON.stringify(topic),
          now,
        ),
    ),
    db
      .prepare(
        `UPDATE weekly_reports
         SET status = 'ready',
             overview = ?,
             content_hash = ?,
             item_count = ?,
             stats_json = ?,
             generated_at = ?,
             error_message = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        report.overview,
        report.contentHash,
        report.topics.length,
        JSON.stringify(report.stats),
        report.generatedAt,
        now,
        report.reportId,
      ),
  ];
  await db.batch(statements);
}

export async function failWeeklyReport(
  reportId: string,
  message: string,
): Promise<void> {
  const db = await getDatabase();
  await ensureDatabase(db);
  await db
    .prepare(
      `UPDATE weekly_reports
       SET status = 'failed', error_message = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(message.slice(0, 500), new Date().toISOString(), reportId)
    .run();
}

import { demoSources } from "@/lib/demo-data";
import type {
  CollectionJob,
  ContentItem,
  ContentReview,
  EditorialPipeline,
  EditorialTemplate,
  KnowledgeArticle,
  KnowledgeCategory,
  NormalizedContentInput,
  Platform,
  PublicationStatus,
  ReviewInboxLink,
  RewriteJob,
  RewriteJobStage,
  RewriteJobStatus,
  ReviewQueueStats,
  ReviewStatus,
  Source,
  SourceKind,
  WeeklyReport,
  WeeklyReportStats,
  WeeklyReportStatus,
  WeeklyReportStatusResult,
  WeeklyReportTopic,
} from "@/lib/types";
import { normalizeEditorialPipeline } from "@/lib/editorial-pipeline";
import {
  createKnowledgeSlug,
  inferKnowledgeCategory,
  knowledgeExcerpt,
} from "@/lib/knowledge";
import {
  calculateContentValueScore,
  recommendationScore,
} from "@/lib/content-value";
import {
  authorFrom,
  avatarFrom,
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

export const contentFromRow = (row: Row): ContentItem => {
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
  const authorAvatarUrl = row.author_avatar_url
    ? String(row.author_avatar_url)
    : avatarFrom(raw, platform);
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
    authorAvatarUrl,
    publishedAt,
    fetchedAt,
    metrics,
    hotScore: 0,
    tags: parseJson<string[]>(row.tags_json, []),
    aiSummary: row.ai_summary ? String(row.ai_summary) : undefined,
    summaryStatus: String(row.summary_status) as ContentItem["summaryStatus"],
    sourceName: row.source_name ? String(row.source_name) : raw.radarSearchQuery ? "手动话题搜索" : undefined,
    sourceTarget: row.source_target ? String(row.source_target) : typeof raw.radarSearchQuery === "string" ? raw.radarSearchQuery : undefined,
    isRewriteCandidate: Boolean(row.rewrite_candidate_added_at),
    rewriteCandidateAddedAt: row.rewrite_candidate_added_at
      ? String(row.rewrite_candidate_added_at)
      : undefined,
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

const rewriteJobFromRow = (row: Row): RewriteJob => ({
  id: String(row.id),
  contentId: String(row.content_id),
  status: String(row.status) as RewriteJobStatus,
  stage: String(row.stage) as RewriteJobStage,
  progress: Number(row.progress ?? 0),
  message: String(row.message ?? ""),
  profileId: String(row.profile_id),
  profileVersion: String(row.profile_version),
  template: String(row.template) as EditorialTemplate,
  knowledgeCategory: String(row.knowledge_category) as KnowledgeCategory,
  errorMessage: row.error_message ? String(row.error_message) : undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  completedAt: row.completed_at ? String(row.completed_at) : null,
});

const reviewFromRow = (row: Row): ContentReview => {
  const source = contentFromRow(row);
  const snapshot = parseJson<ContentItem | null>(
    row.review_source_snapshot_json,
    null,
  );
  const editorialPipeline = normalizeEditorialPipeline(
    parseJson<Partial<EditorialPipeline>>(
      row.review_editorial_pipeline_json,
      {},
    ),
    String(row.review_updated_at ?? source.fetchedAt),
  );
  return {
    id: row.review_id ? String(row.review_id) : `review-${source.id}`,
    contentId: source.id,
    status: String(row.review_status ?? "pending") as ReviewStatus,
    sourceTier: String(row.review_source_tier ?? "B") as ContentReview["sourceTier"],
    template: String(
      row.review_template ?? "knowledge_card",
    ) as EditorialTemplate,
    knowledgeCategory: String(
      row.review_knowledge_category ?? inferKnowledgeCategory(source),
    ) as KnowledgeCategory,
    sourceSnapshot: snapshot?.id ? snapshot : source,
    aiDraft: String(row.review_ai_draft ?? ""),
    editorTitle: String(row.review_editor_title ?? source.title),
    editorContent: String(row.review_editor_content ?? ""),
    editorNote: String(row.review_editor_note ?? ""),
    reviewerName: String(row.review_reviewer_name ?? ""),
    editorialPipeline,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    publicationStatus: String(
      row.review_publication_status ?? "draft",
    ) as PublicationStatus,
    feishuDocumentId: row.feishu_document_id
      ? String(row.feishu_document_id)
      : undefined,
    feishuWikiNodeToken: row.feishu_wiki_node_token
      ? String(row.feishu_wiki_node_token)
      : undefined,
    feishuUrl: row.feishu_url ? String(row.feishu_url) : undefined,
    publishedContentHash: row.published_content_hash
      ? String(row.published_content_hash)
      : undefined,
    publishedAt: row.review_published_at
      ? String(row.review_published_at)
      : null,
    publishError: row.review_publish_error
      ? String(row.review_publish_error)
      : undefined,
    sitePublicationStatus: String(
      row.review_site_publication_status ?? "draft",
    ) as PublicationStatus,
    knowledgeArticleId: row.knowledge_article_id
      ? String(row.knowledge_article_id)
      : undefined,
    siteUrl: row.site_url ? String(row.site_url) : undefined,
    sitePublishedAt: row.site_published_at
      ? String(row.site_published_at)
      : null,
    sitePublishError: row.site_publish_error
      ? String(row.site_publish_error)
      : undefined,
    createdAt: String(row.review_created_at ?? source.fetchedAt),
    updatedAt: String(row.review_updated_at ?? source.fetchedAt),
    source,
  };
};

const reviewSelect = `SELECT
  c.*, s.name AS source_name, s.target AS source_target,
  rc.added_at AS rewrite_candidate_added_at,
  r.id AS review_id,
  r.status AS review_status,
  r.source_tier AS review_source_tier,
  r.template AS review_template,
  r.knowledge_category AS review_knowledge_category,
  r.source_snapshot_json AS review_source_snapshot_json,
  r.ai_draft AS review_ai_draft,
  r.editor_title AS review_editor_title,
  r.editor_content AS review_editor_content,
  r.editor_note AS review_editor_note,
  r.reviewer_name AS review_reviewer_name,
  r.editorial_pipeline_json AS review_editorial_pipeline_json,
  r.reviewed_at AS reviewed_at,
  r.publication_status AS review_publication_status,
  r.feishu_document_id AS feishu_document_id,
  r.feishu_wiki_node_token AS feishu_wiki_node_token,
  r.feishu_url AS feishu_url,
  r.published_content_hash AS published_content_hash,
  r.published_at AS review_published_at,
  r.publish_error AS review_publish_error,
  r.site_publication_status AS review_site_publication_status,
  r.knowledge_article_id AS knowledge_article_id,
  r.site_url AS site_url,
  r.site_published_at AS site_published_at,
  r.site_publish_error AS site_publish_error,
  r.created_at AS review_created_at,
  r.updated_at AS review_updated_at
FROM contents c
LEFT JOIN sources s ON s.id = c.source_id
LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
LEFT JOIN content_reviews r ON r.content_id = c.id`;

const knowledgeFocusSourceIds = [
  "src-x-codex-skills",
  "src-x-open-source-projects",
  "src-x-overseas-practice",
  "src-yt-tested-tutorials",
];

const knowledgeFocusKeywords = [
  "codex",
  "skill",
  "mcp",
  "agent",
  "workflow",
  "open source",
  "github",
  "gitlab",
  "tutorial",
  "how to",
  "walkthrough",
  "benchmark",
  "开源",
  "教程",
  "实测",
  "配置",
  "部署",
  "排障",
  "工作流",
  "自动化",
];

function knowledgeFocusFilter(): {
  clause: string;
  values: string[];
} {
  const sourcePlaceholders = knowledgeFocusSourceIds.map(() => "?").join(", ");
  const searchable = "LOWER(c.title || ' ' || c.body)";
  return {
    clause: `(c.source_id IN (${sourcePlaceholders}) OR (
      c.hot_score >= 55 AND (
        ${knowledgeFocusKeywords.map(() => `${searchable} LIKE ?`).join(" OR ")}
      )
    ))`,
    values: [
      ...knowledgeFocusSourceIds,
      ...knowledgeFocusKeywords.map((keyword) => `%${keyword.toLowerCase()}%`),
    ],
  };
}

const knowledgeArticleFromRow = (row: Row): KnowledgeArticle => ({
  id: String(row.id),
  contentId: String(row.content_id),
  slug: String(row.slug),
  category: String(row.category) as KnowledgeCategory,
  title: String(row.title),
  excerpt: String(row.excerpt ?? ""),
  bodyMarkdown: String(row.body_markdown),
  sourceSnapshot: parseJson<ContentItem>(
    row.source_snapshot_json,
    {} as ContentItem,
  ),
  tags: parseJson<string[]>(row.tags_json, []),
  status: String(row.status) as KnowledgeArticle["status"],
  publishedAt: String(row.published_at),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
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
    {
      id: "default-sources-knowledge-focus-v1",
      sourceIds: [
        "src-x-codex-skills",
        "src-x-open-source-projects",
        "src-x-overseas-practice",
        "src-yt-tested-tutorials",
      ],
    },
    {
      id: "default-source-github-ai-star-growth-v1",
      sourceIds: ["src-github-ai-star-growth"],
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
      `SELECT c.*, s.name AS source_name, s.target AS source_target,
              rc.added_at AS rewrite_candidate_added_at
       FROM contents c
       LEFT JOIN sources s ON s.id = c.source_id
       LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
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
      `SELECT c.*, s.name AS source_name, s.target AS source_target,
              rc.added_at AS rewrite_candidate_added_at
       FROM contents c
       LEFT JOIN sources s ON s.id = c.source_id
       LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
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

export async function getContentById(
  contentId: string,
): Promise<ContentItem | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare(
      `SELECT c.*, s.name AS source_name, s.target AS source_target,
              rc.added_at AS rewrite_candidate_added_at
       FROM contents c
       LEFT JOIN sources s ON s.id = c.source_id
       LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
       WHERE c.id = ?`,
    )
    .bind(contentId)
    .first<Row>();
  return row ? contentFromRow(row) : null;
}

export interface GitHubStarSnapshotInput {
  repositoryId: string;
  fullName: string;
  stars: number;
  forks: number;
  capturedDate: string;
  capturedAt: string;
  repository: unknown;
}

export async function saveGitHubStarSnapshots(
  snapshots: GitHubStarSnapshotInput[],
): Promise<void> {
  if (!snapshots.length) return;
  const db = await getDatabase();
  await ensureDatabase(db);
  const statements = snapshots.map((snapshot) =>
    db
      .prepare(
        `INSERT INTO github_star_snapshots (
          id, repository_id, full_name, stars, forks,
          captured_date, captured_at, repository_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository_id, captured_date) DO UPDATE SET
          full_name = excluded.full_name,
          stars = excluded.stars,
          forks = excluded.forks,
          captured_at = excluded.captured_at,
          repository_json = excluded.repository_json`,
      )
      .bind(
        `ghs-${snapshot.repositoryId}-${snapshot.capturedDate}`,
        snapshot.repositoryId,
        snapshot.fullName,
        Math.max(0, Math.round(snapshot.stars)),
        Math.max(0, Math.round(snapshot.forks)),
        snapshot.capturedDate,
        snapshot.capturedAt,
        JSON.stringify(snapshot.repository),
      ),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  const retentionDate = new Date(Date.now() - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db
    .prepare("DELETE FROM github_star_snapshots WHERE captured_date < ?")
    .bind(retentionDate)
    .run();
}

export async function getGitHubStarSnapshotMap(
  repositoryIds: string[],
  capturedDate: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!repositoryIds.length) return result;
  const db = await getDatabase();
  await ensureDatabase(db);
  const uniqueIds = [...new Set(repositoryIds)];
  for (let index = 0; index < uniqueIds.length; index += 80) {
    const ids = uniqueIds.slice(index, index + 80);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await db
      .prepare(
        `SELECT repository_id, stars
         FROM github_star_snapshots
         WHERE captured_date = ? AND repository_id IN (${placeholders})`,
      )
      .bind(capturedDate, ...ids)
      .all<Row>();
    for (const row of rows.results) {
      result.set(String(row.repository_id), Number(row.stars ?? 0));
    }
  }
  return result;
}

export async function listContentReviews(options?: {
  status?: ReviewStatus | "all";
  query?: string;
  limit?: number;
  focus?: "candidates" | "knowledge" | "all";
}): Promise<ContentReview[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const status = options?.status ?? "all";
  const query = options?.query?.trim().toLowerCase() ?? "";
  const limit = Math.min(300, Math.max(1, options?.limit ?? 120));
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const focusMode = options?.focus ?? "all";
  if (focusMode === "candidates") {
    clauses.push("rc.content_id IS NOT NULL");
  } else if (focusMode === "knowledge") {
    const focus = knowledgeFocusFilter();
    clauses.push(focus.clause);
    values.push(...focus.values);
  }
  if (status !== "all") {
    clauses.push("COALESCE(r.status, 'pending') = ?");
    values.push(status);
  }
  if (query) {
    clauses.push(
      "LOWER(c.title || ' ' || c.body || ' ' || c.author_name) LIKE ?",
    );
    values.push(`%${query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const knowledgeFocused = focusMode === "knowledge";
  const candidateFocused = focusMode === "candidates";
  const result = await db
    .prepare(
      `${reviewSelect}
       ${where}
       ORDER BY
         CASE COALESCE(r.status, 'pending')
           WHEN 'needs_revision' THEN 0
           WHEN 'pending' THEN 1
           WHEN 'approved' THEN 2
           ELSE 3
         END,
         ${candidateFocused ? "rc.added_at DESC, c.hot_score DESC" : knowledgeFocused ? "c.hot_score DESC, c.published_at DESC" : "c.published_at DESC, c.hot_score DESC"}
       LIMIT ?`,
    )
    .bind(...values, limit)
    .all<Row>();
  return result.results.map(reviewFromRow);
}

export async function listPublishedFeishuReviews(
  limit = 2_000,
): Promise<ContentReview[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare(
      `${reviewSelect}
       WHERE r.publication_status = 'published'
         AND r.status = 'approved'
       ORDER BY r.published_at ASC, r.updated_at ASC
       LIMIT ?`,
    )
    .bind(Math.min(5_000, Math.max(1, limit)))
    .all<Row>();
  return result.results.map(reviewFromRow);
}

export async function getContentReview(
  contentId: string,
): Promise<ContentReview | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare(`${reviewSelect} WHERE c.id = ?`)
    .bind(contentId)
    .first<Row>();
  return row ? reviewFromRow(row) : null;
}

export async function getReviewQueueStats(
  focus: "candidates" | "knowledge" | "all" = "candidates",
): Promise<ReviewQueueStats> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const focusFilter = focus === "knowledge" ? knowledgeFocusFilter() : null;
  const focusWhere =
    focus === "candidates"
      ? "WHERE EXISTS (SELECT 1 FROM rewrite_candidates rc WHERE rc.content_id = c.id)"
      : focusFilter
        ? `WHERE ${focusFilter.clause}`
        : "";
  const [statuses, published, sitePublished] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(r.status, 'pending') AS status, COUNT(*) AS count
         FROM contents c
         LEFT JOIN content_reviews r ON r.content_id = c.id
         ${focusWhere}
         GROUP BY COALESCE(r.status, 'pending')`,
      )
      .bind(...(focusFilter?.values ?? []))
      .all<Row>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM content_reviews
         WHERE publication_status = 'published'`,
      )
      .first<Row>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM knowledge_articles
         WHERE status = 'published'`,
      )
      .first<Row>(),
  ]);
  const stats: ReviewQueueStats = {
    pending: 0,
    approved: 0,
    needsRevision: 0,
    rejected: 0,
    published: Number(published?.count ?? 0),
    sitePublished: Number(sitePublished?.count ?? 0),
  };
  for (const row of statuses.results) {
    const count = Number(row.count ?? 0);
    if (row.status === "approved") stats.approved = count;
    if (row.status === "rejected") stats.rejected = count;
    if (row.status === "needs_revision") stats.needsRevision = count;
    if (row.status === "pending") stats.pending = count;
  }
  return stats;
}

export async function setRewriteCandidate(
  contentId: string,
  selected: boolean,
): Promise<ContentItem | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const content = await db
    .prepare("SELECT id FROM contents WHERE id = ?")
    .bind(contentId)
    .first<{ id: string }>();
  if (!content) return null;

  if (selected) {
    await db
      .prepare(
        `INSERT INTO rewrite_candidates (content_id, added_at)
         VALUES (?, ?)
         ON CONFLICT(content_id) DO NOTHING`,
      )
      .bind(contentId, new Date().toISOString())
      .run();
  } else {
    await db
      .prepare("DELETE FROM rewrite_candidates WHERE content_id = ?")
      .bind(contentId)
      .run();
  }

  return getContentById(contentId);
}

export async function countRewriteCandidates(): Promise<number> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM rewrite_candidates")
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function listReviewInboxLinks(): Promise<ReviewInboxLink[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const result = await db
    .prepare(
      `SELECT content_id, url, title, platform, author_name, added_at
       FROM review_inbox_links
       ORDER BY added_at DESC`,
    )
    .all<Row>();
  return result.results.map((row) => ({
    contentId: String(row.content_id),
    url: String(row.url),
    title: String(row.title),
    platform: String(row.platform) as Platform,
    authorName: String(row.author_name ?? ""),
    addedAt: String(row.added_at),
  }));
}

export async function saveReviewInboxLink(
  contentId: string,
): Promise<ReviewInboxLink | null> {
  const content = await getContentById(contentId);
  if (!content) return null;
  const db = await getDatabase();
  await ensureDatabase(db);
  const addedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO review_inbox_links (
         content_id, url, title, platform, author_name, added_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         url = excluded.url,
         title = excluded.title,
         platform = excluded.platform,
         author_name = excluded.author_name`,
    )
    .bind(
      content.id,
      content.url,
      content.title,
      content.platform,
      content.authorName,
      addedAt,
    )
    .run();

  return {
    contentId: content.id,
    url: content.url,
    title: content.title,
    platform: content.platform,
    authorName: content.authorName,
    addedAt,
  };
}

export async function createRewriteJob(input: {
  contentId: string;
  profileId: string;
  profileVersion: string;
  template: EditorialTemplate;
  knowledgeCategory: KnowledgeCategory;
}): Promise<RewriteJob | null> {
  const content = await getContentById(input.contentId);
  if (!content) return null;
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  const id = `rewrite-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO rewrite_jobs (
        id, content_id, status, stage, progress, message,
        profile_id, profile_version, template, knowledge_category,
        error_message, created_at, updated_at, completed_at
       ) VALUES (?, ?, 'queued', 'queued', 0, '等待补全原始内容', ?, ?, ?, ?, NULL, ?, ?, NULL)
       ON CONFLICT(content_id) DO UPDATE SET
         id = excluded.id,
         status = 'queued',
         stage = 'queued',
         progress = 0,
         message = excluded.message,
         profile_id = excluded.profile_id,
         profile_version = excluded.profile_version,
         template = excluded.template,
         knowledge_category = excluded.knowledge_category,
         error_message = NULL,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         completed_at = NULL`,
    )
    .bind(
      id,
      input.contentId,
      input.profileId,
      input.profileVersion,
      input.template,
      input.knowledgeCategory,
      now,
      now,
    )
    .run();
  return getRewriteJob(id);
}

export async function getRewriteJob(jobId: string): Promise<RewriteJob | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare("SELECT * FROM rewrite_jobs WHERE id = ?")
    .bind(jobId)
    .first<Row>();
  return row ? rewriteJobFromRow(row) : null;
}

export async function getRewriteJobByContentId(
  contentId: string,
): Promise<RewriteJob | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare("SELECT * FROM rewrite_jobs WHERE content_id = ?")
    .bind(contentId)
    .first<Row>();
  return row ? rewriteJobFromRow(row) : null;
}

export async function listRewriteJobsForContents(
  contentIds: string[],
): Promise<RewriteJob[]> {
  const ids = [...new Set(contentIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) return [];
  const db = await getDatabase();
  await ensureDatabase(db);
  const jobs: RewriteJob[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT * FROM rewrite_jobs
         WHERE content_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<Row>();
    jobs.push(...result.results.map(rewriteJobFromRow));
  }
  return jobs.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function updateRewriteJob(
  jobId: string,
  input: Partial<
    Pick<
      RewriteJob,
      | "status"
      | "stage"
      | "progress"
      | "message"
      | "errorMessage"
      | "completedAt"
    >
  >,
): Promise<RewriteJob | null> {
  const current = await getRewriteJob(jobId);
  if (!current) return null;
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rewrite_jobs SET
         status = ?, stage = ?, progress = ?, message = ?,
         error_message = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.status ?? current.status,
      input.stage ?? current.stage,
      Math.max(0, Math.min(100, input.progress ?? current.progress)),
      input.message ?? current.message,
      input.errorMessage === undefined
        ? current.errorMessage ?? null
        : input.errorMessage || null,
      now,
      input.completedAt === undefined
        ? current.completedAt
        : input.completedAt,
      jobId,
    )
    .run();
  return getRewriteJob(jobId);
}

export async function saveContentReview(
  contentId: string,
  input: Partial<
    Pick<
      ContentReview,
      | "status"
      | "sourceTier"
      | "template"
      | "knowledgeCategory"
      | "aiDraft"
      | "editorTitle"
      | "editorContent"
      | "editorNote"
      | "reviewerName"
    >
  > & { editorialPipeline?: Partial<EditorialPipeline> },
): Promise<ContentReview | null> {
  const source = await getContentById(contentId);
  if (!source) return null;
  const db = await getDatabase();
  const existing = await db
    .prepare("SELECT * FROM content_reviews WHERE content_id = ?")
    .bind(contentId)
    .first<Row>();
  const now = new Date().toISOString();
  const status = input.status ?? String(existing?.status ?? "pending");
  const reviewedAt =
    status === "approved" || status === "rejected"
      ? now
      : existing?.reviewed_at
        ? String(existing.reviewed_at)
        : null;
  const storedPipeline = normalizeEditorialPipeline(
    parseJson<Partial<EditorialPipeline>>(
      existing?.editorial_pipeline_json,
      {},
    ),
    existing?.updated_at ? String(existing.updated_at) : now,
  );
  const editorialPipeline = input.editorialPipeline
    ? normalizeEditorialPipeline(
        {
          ...storedPipeline,
          ...input.editorialPipeline,
          updatedAt: now,
          lastError: input.editorialPipeline.lastError,
        },
        now,
      )
    : storedPipeline;
  await db
    .prepare(
      `INSERT INTO content_reviews (
        id, content_id, status, source_tier, template, knowledge_category,
        source_snapshot_json,
        ai_draft, editor_title, editor_content, editor_note, reviewer_name,
        editorial_pipeline_json, reviewed_at, publication_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
       ON CONFLICT(content_id) DO UPDATE SET
         status = excluded.status,
         source_tier = excluded.source_tier,
         template = excluded.template,
         knowledge_category = excluded.knowledge_category,
         ai_draft = excluded.ai_draft,
         editor_title = excluded.editor_title,
         editor_content = excluded.editor_content,
         editor_note = excluded.editor_note,
         reviewer_name = excluded.reviewer_name,
         editorial_pipeline_json = excluded.editorial_pipeline_json,
         reviewed_at = excluded.reviewed_at,
         publication_status = CASE
           WHEN content_reviews.publication_status = 'published'
             AND (content_reviews.editor_title != excluded.editor_title
               OR content_reviews.editor_content != excluded.editor_content)
           THEN 'draft'
           ELSE content_reviews.publication_status
         END,
         site_publication_status = CASE
           WHEN content_reviews.site_publication_status = 'published'
             AND (content_reviews.editor_title != excluded.editor_title
               OR content_reviews.editor_content != excluded.editor_content
               OR content_reviews.knowledge_category != excluded.knowledge_category)
           THEN 'draft'
           ELSE content_reviews.site_publication_status
         END,
         publish_error = NULL,
         site_publish_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      existing?.id ? String(existing.id) : `review-${crypto.randomUUID()}`,
      contentId,
      status,
      input.sourceTier ?? String(existing?.source_tier ?? "B"),
      input.template ?? String(existing?.template ?? "knowledge_card"),
      input.knowledgeCategory ??
        String(existing?.knowledge_category ?? inferKnowledgeCategory(source)),
      existing?.source_snapshot_json
        ? String(existing.source_snapshot_json)
        : JSON.stringify(source),
      input.aiDraft ?? String(existing?.ai_draft ?? ""),
      input.editorTitle ?? String(existing?.editor_title ?? source.title),
      input.editorContent ?? String(existing?.editor_content ?? ""),
      input.editorNote ?? String(existing?.editor_note ?? ""),
      input.reviewerName ?? String(existing?.reviewer_name ?? ""),
      JSON.stringify(editorialPipeline),
      reviewedAt,
      existing?.created_at ? String(existing.created_at) : now,
      now,
    )
    .run();
  return getContentReview(contentId);
}

export async function setReviewPublicationState(
  contentId: string,
  input: {
    status: PublicationStatus;
    documentId?: string;
    wikiNodeToken?: string;
    url?: string;
    contentHash?: string;
    error?: string;
  },
): Promise<ContentReview | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE content_reviews
       SET publication_status = ?,
           feishu_document_id = COALESCE(?, feishu_document_id),
           feishu_wiki_node_token = COALESCE(?, feishu_wiki_node_token),
           feishu_url = COALESCE(?, feishu_url),
           published_content_hash = COALESCE(?, published_content_hash),
           published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
           publish_error = ?,
           updated_at = ?
       WHERE content_id = ?`,
    )
    .bind(
      input.status,
      input.documentId ?? null,
      input.wikiNodeToken ?? null,
      input.url ?? null,
      input.contentHash ?? null,
      input.status,
      now,
      input.error ?? null,
      now,
      contentId,
    )
    .run();
  return getContentReview(contentId);
}

export async function setReviewSitePublicationState(
  contentId: string,
  input: {
    status: PublicationStatus;
    articleId?: string;
    url?: string;
    error?: string;
  },
): Promise<ContentReview | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE content_reviews
       SET site_publication_status = ?,
           knowledge_article_id = COALESCE(?, knowledge_article_id),
           site_url = COALESCE(?, site_url),
           site_published_at = CASE
             WHEN ? = 'published' THEN COALESCE(site_published_at, ?)
             ELSE site_published_at
           END,
           site_publish_error = ?,
           updated_at = ?
       WHERE content_id = ?`,
    )
    .bind(
      input.status,
      input.articleId ?? null,
      input.url ?? null,
      input.status,
      now,
      input.error ?? null,
      now,
      contentId,
    )
    .run();
  return getContentReview(contentId);
}

export async function publishReviewToKnowledgeSite(
  review: ContentReview,
): Promise<{ review: ContentReview; article: KnowledgeArticle }> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const existing = await db
    .prepare("SELECT id, slug, published_at, created_at FROM knowledge_articles WHERE content_id = ?")
    .bind(review.contentId)
    .first<Row>();
  const now = new Date().toISOString();
  const articleId = existing?.id
    ? String(existing.id)
    : `knowledge-${crypto.randomUUID()}`;
  const slug = existing?.slug
    ? String(existing.slug)
    : createKnowledgeSlug(
        review.editorTitle,
        review.contentId,
        review.knowledgeCategory,
      );
  const publishedAt = existing?.published_at
    ? String(existing.published_at)
    : now;
  const createdAt = existing?.created_at ? String(existing.created_at) : now;
  const siteUrl = `/knowledge/${slug}`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO knowledge_articles (
          id, content_id, slug, category, title, excerpt, body_markdown,
          source_snapshot_json, tags_json, status, published_at, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
        ON CONFLICT(content_id) DO UPDATE SET
          category = excluded.category,
          title = excluded.title,
          excerpt = excluded.excerpt,
          body_markdown = excluded.body_markdown,
          source_snapshot_json = excluded.source_snapshot_json,
          tags_json = excluded.tags_json,
          status = 'published',
          updated_at = excluded.updated_at`,
      )
      .bind(
        articleId,
        review.contentId,
        slug,
        review.knowledgeCategory,
        review.editorTitle,
        knowledgeExcerpt(review.editorContent),
        review.editorContent,
        JSON.stringify(review.sourceSnapshot),
        JSON.stringify(review.sourceSnapshot.tags),
        publishedAt,
        createdAt,
        now,
      ),
    db
      .prepare(
        `UPDATE content_reviews
         SET site_publication_status = 'published',
             knowledge_article_id = ?,
             site_url = ?,
             site_published_at = COALESCE(site_published_at, ?),
             site_publish_error = NULL,
             updated_at = ?
         WHERE content_id = ?`,
      )
      .bind(articleId, siteUrl, now, now, review.contentId),
  ]);

  const [updatedReview, article] = await Promise.all([
    getContentReview(review.contentId),
    getKnowledgeArticleBySlug(slug),
  ]);
  if (!updatedReview || !article) {
    throw new Error("知识库文章发布后读取失败");
  }
  return { review: updatedReview, article };
}

export async function listKnowledgeArticles(options?: {
  category?: KnowledgeCategory | "all";
  query?: string;
  limit?: number;
}): Promise<KnowledgeArticle[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const category = options?.category ?? "all";
  const query = options?.query?.trim().toLowerCase() ?? "";
  const clauses = ["status = 'published'"];
  const values: Array<string | number> = [];
  if (category !== "all") {
    clauses.push("category = ?");
    values.push(category);
  }
  if (query) {
    clauses.push("LOWER(title || ' ' || excerpt || ' ' || body_markdown) LIKE ?");
    values.push(`%${query}%`);
  }
  const rows = await db
    .prepare(
      `SELECT * FROM knowledge_articles
       WHERE ${clauses.join(" AND ")}
       ORDER BY published_at DESC, updated_at DESC
       LIMIT ?`,
    )
    .bind(...values, Math.min(500, Math.max(1, options?.limit ?? 120)))
    .all<Row>();
  return rows.results.map(knowledgeArticleFromRow);
}

export async function getKnowledgeArticleBySlug(
  slug: string,
): Promise<KnowledgeArticle | null> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const row = await db
    .prepare(
      `SELECT * FROM knowledge_articles
       WHERE slug = ? AND status = 'published'
       LIMIT 1`,
    )
    .bind(slug)
    .first<Row>();
  return row ? knowledgeArticleFromRow(row) : null;
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
    github: 0,
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
        author_name, author_handle, author_avatar_url, published_at, fetched_at, metrics_json,
        hot_score, tags_json, ai_summary, summary_status, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET
        source_id = excluded.source_id,
        title = excluded.title,
        body = excluded.body,
        url = excluded.url,
        author_name = excluded.author_name,
        author_handle = excluded.author_handle,
        author_avatar_url = COALESCE(excluded.author_avatar_url, contents.author_avatar_url),
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
      item.authorAvatarUrl ?? null,
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

export async function listWeeklyReportStatuses(
  limit = 12,
): Promise<WeeklyReportStatusResult[]> {
  const db = await getDatabase();
  await ensureDatabase(db);
  const rows = await db
    .prepare(
      `SELECT id, week_start, week_end, timezone, status, generated_at,
              item_count, error_message
       FROM weekly_reports
       ORDER BY week_start DESC, generated_at DESC
       LIMIT ?`,
    )
    .bind(Math.min(52, Math.max(1, limit)))
    .all<Row>();
  return rows.results.map((row) => ({
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
  }));
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

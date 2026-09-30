import { ensureDatabase } from "./runtime";
import { contentFromRow, getDatabase } from "./repository";
import { buildSearchSql, SEARCH_PAGE_SIZE, type SearchOptions } from "@/lib/topic-search";
import { calculateContentValueScore } from "@/lib/content-value";
import type { NormalizedContentInput } from "@/lib/types";

export async function searchStoredContents(options: SearchOptions) {
  const db = await getDatabase();
  await ensureDatabase(db);
  const { where, bindings, order, orderBindings } = buildSearchSql(options);
  const [count, rows] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) AS total FROM contents c WHERE ${where}`).bind(...bindings),
    db.prepare(`SELECT c.*, s.name AS source_name, s.target AS source_target,
      rc.added_at AS rewrite_candidate_added_at FROM contents c
      LEFT JOIN sources s ON s.id = c.source_id
      LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
      WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...bindings, ...orderBindings, SEARCH_PAGE_SIZE, (options.page - 1) * SEARCH_PAGE_SIZE),
  ]);
  const total = Number((count.results[0] as { total: number } | undefined)?.total ?? 0);
  return {
    items: rows.results.map(contentFromRow), total, page: options.page,
    pageSize: SEARCH_PAGE_SIZE, hasMore: options.page * SEARCH_PAGE_SIZE < total,
  };
}

// Manual searches never create scheduled sources or overwrite richer existing
// collection/rewrite data. A platform/external-id conflict simply reuses it.
export async function saveSearchContents(items: NormalizedContentInput[], query: string) {
  if (!items.length) return { items: [], added: 0 };
  const unique = [...new Map(items.map((item) => [`${item.platform}:${item.externalId}`, item])).values()];
  const db = await getDatabase();
  await ensureDatabase(db);
  const now = new Date().toISOString();
  const inserts = unique.map((item) => db.prepare(`INSERT INTO contents (
    id, platform, external_id, source_id, content_type, title, body, url,
    author_name, author_handle, author_avatar_url, published_at, fetched_at,
    metrics_json, hot_score, tags_json, summary_status, raw_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    ON CONFLICT(platform, external_id) DO NOTHING`).bind(
    `cnt-${crypto.randomUUID()}`, item.platform, item.externalId, `search-${item.platform}`,
    item.type, item.title, item.body, item.url, item.authorName, item.authorHandle ?? null,
    item.authorAvatarUrl ?? null, item.publishedAt, item.fetchedAt,
    JSON.stringify(item.metrics), calculateContentValueScore(item), JSON.stringify(item.tags),
    JSON.stringify({ ...(item.raw && typeof item.raw === "object" ? item.raw : {}),
      radarSearchQuery: query }), now, now,
  ));
  const result = await db.batch(inserts);
  const rows = await db.prepare(`SELECT c.*, s.name AS source_name, s.target AS source_target,
    rc.added_at AS rewrite_candidate_added_at FROM contents c
    LEFT JOIN sources s ON s.id = c.source_id
    LEFT JOIN rewrite_candidates rc ON rc.content_id = c.id
    WHERE ${unique.map(() => "(c.platform = ? AND c.external_id = ?)").join(" OR ")}`)
    .bind(...unique.flatMap((item) => [item.platform, item.externalId])).all();
  const byId = new Map(rows.results.map((row) => {
    const item = contentFromRow(row);
    return [`${item.platform}:${item.externalId}`, item];
  }));
  return {
    items: unique.flatMap((item) => {
      const stored = byId.get(`${item.platform}:${item.externalId}`);
      return stored ? [stored] : [];
    }),
    added: result.reduce((sum, entry) => sum + Number(entry.meta.changes || 0), 0),
  };
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

// Exercise actual modules and SQLite SQL without user data or paid API calls.
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const search = await load("../lib/topic-search.ts");
const origin = await load("../lib/same-origin.ts");
const helpers = await load("../lib/connectors/helpers.ts");
const config = await load("../lib/source-config.ts");
const value = await load("../lib/content-value.ts", { "./hot-score": await load("../lib/hot-score.ts") });
const options = (overrides = {}) => search.parseSearchOptions({
  query: "Codex", platforms: ["x", "youtube"], range: "all", sort: "relevance", ...overrides,
});
const item = (id = "1", overrides = {}) => ({
  externalId: id, platform: "x", type: "post", title: "Codex 使用技巧",
  body: "AI 开发工具的实践", url: `https://x.com/test/status/${id}`, authorName: "作者甲",
  authorHandle: "@Builder", publishedAt: "2025-01-01T00:00:00.000Z", fetchedAt: new Date().toISOString(),
  metrics: {}, tags: ["编程"], raw: {}, ...overrides,
});

async function harness(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args), meta: {} }; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async execute() { return /^\s*SELECT/i.test(sql) ? this.all() : this.run(); },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.execute())); },
  };
  const runtime = await load("../db/runtime.ts");
  const repository = await load("../db/repository.ts", {
    "@/lib/demo-data": { demoSources: [] }, "@/lib/editorial-pipeline": {}, "@/lib/knowledge": {},
    "@/lib/content-value": value, "@/lib/connectors/helpers": helpers,
    "./runtime": { ...runtime, getAppEnv: async () => ({ DB: db }) },
  });
  const store = await load("../db/search.ts", { "./runtime": runtime, "./repository": repository,
    "@/lib/topic-search": search, "@/lib/content-value": value });
  await runtime.ensureDatabase(db);
  return { sqlite, db, repository, store };
}

test("search validates query, platform whitelist, empty selection, ranges and pagination", () => {
  assert.throws(() => options({ query: " " }), /关键词/);
  assert.throws(() => options({ query: "x".repeat(161) }), /160/);
  assert.throws(() => options({ platforms: [] }), /至少勾选/);
  assert.throws(() => options({ platforms: ["x); DROP TABLE contents"] }), /平台/);
  for (const page of [-1, 0, 1.1, "no", 10001]) assert.throws(() => options({ page }), /页码/);
  assert.throws(() => search.parseSearchOptions({ ...options(), platforms: ["linuxdo"], range: "month" }, true), /实时搜索仅支持/);
  assert.throws(() => search.parseSearchOptions(options(), true), /时间范围/);
  assert.deepEqual(options({ query: "  Codex   CLI ", platforms: ["x", "x"] }).platforms, ["x"]);
  assert.equal(options({ query: "  Codex   CLI " }).query, "Codex CLI");
});

test("whole-database search finds matches older than the feed's 500 items and honors multiple platforms", async (t) => {
  const { sqlite, store } = await harness(t);
  await store.saveSearchContents([item("old-x"), item("old-y", { platform: "youtube", type: "video" }),
    item("old-linux", { platform: "linuxdo", type: "topic" })], "Codex");
  const seed = sqlite.prepare(`INSERT INTO contents SELECT ?, platform, ?, source_id, content_type,
    'Unrelated news', body, url, author_name, author_handle, author_avatar_url, '2026-09-27T00:00:00.000Z', fetched_at,
    metrics_json, hot_score, tags_json, ai_summary, summary_status, raw_json, created_at, updated_at
    FROM contents WHERE external_id = 'old-x'`);
  for (let n = 0; n < 550; n++) seed.run(`filler-${n}`, `filler-${n}`);
  const result = await store.searchStoredContents(options({ query: "codex" }));
  assert.equal(result.total, 2);
  assert.deepEqual(new Set(result.items.map((item) => item.platform)), new Set(["x", "youtube"]));
  assert.equal((await store.searchStoredContents(options({ platforms: ["linuxdo"] }))).total, 1);
});

test("local search treats wildcard and SQL-looking text literally and matches Chinese, author and tags", async (t) => {
  const { store } = await harness(t);
  await store.saveSearchContents([item("literal", { title: "100%_成功", body: "中文教程", authorName: "Alice" }), item("other")], "test");
  assert.equal((await store.searchStoredContents(options({ query: "%_" }))).total, 1);
  assert.equal((await store.searchStoredContents(options({ query: "alice 中文" }))).total, 1);
  assert.equal((await store.searchStoredContents(options({ query: "builder 编程" }))).total, 2);
  assert.equal((await store.searchStoredContents(options({ query: "' OR 1=1 --" }))).total, 0);
});

test("database pagination, title relevance and date filters are stable with no demo fallback", async (t) => {
  const { store } = await harness(t);
  for (let n = 0; n < 32; n++) await store.saveSearchContents([item(String(n), { title: n === 0 ? "Codex" : "编程经验", body: "Codex", publishedAt: new Date().toISOString() })], "Codex");
  await store.saveSearchContents([item("very-old")], "Codex");
  const first = await store.searchStoredContents(options({ range: "week" }));
  const second = await store.searchStoredContents(options({ range: "week", page: 2 }));
  assert.equal(first.total, 32); assert.equal(first.items.length, 30); assert.equal(first.hasMore, true);
  assert.equal(first.items[0].externalId, "0");
  assert.equal(second.items.length, 2); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 32);
  assert.equal((await store.searchStoredContents(options({ query: "not-found" }))).total, 0);
});

test("saving search results is idempotent and never overwrites richer content, review state or creates a monitor", async (t) => {
  const { store, sqlite, repository } = await harness(t);
  const saved = await store.saveSearchContents([item(), item()], "Codex");
  assert.equal(saved.added, 1); assert.equal(saved.items.length, 1);
  const id = saved.items[0].id;
  sqlite.prepare("UPDATE contents SET source_id = 'original-monitor', body = '完整串文', ai_summary = '已有总结', summary_status = 'ready' WHERE id = ?").run(id);
  await repository.saveReviewInboxLink(id);
  const again = await store.saveSearchContents([item("1", { body: "短摘要", metrics: { likes: 99 } })], "New query");
  assert.equal(again.added, 0); assert.equal(again.items[0].id, id);
  assert.equal(again.items[0].body, "完整串文"); assert.equal(again.items[0].aiSummary, "已有总结");
  assert.equal(again.items[0].sourceId, "original-monitor");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM review_inbox_links").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sources").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM rewrite_jobs").get().n, 0);
});

async function liveHarness(overrides = {}) {
  const calls = [], jobs = [];
  const live = await load("../lib/live-search.ts", {
    "@/db/search": { saveSearchContents: async (items) => ({ items: items.map((item) => ({ ...item, id: item.externalId })), added: items.length }) },
    "@/db/repository": { createJob: async (source) => { jobs.push(source); return { id: source.id }; }, finishJob: async () => {} },
    "./connectors/tikhub": { fetchTikHubSource: async (source, env) => { calls.push({ source, env });
      if (overrides.fail === source.platform) throw new Error("HTTP 429 fake-secret-key");
      return { items: [item(source.platform, { platform: source.platform })], billable: true }; } },
    "./connectors/github": { searchGitHubTopic: async (query, env, args) => {
      calls.push({ platform: "github", query, env, args }); return { items: [item("github", { platform: "github" })], billable: false };
    } }, "./topic-search": search,
  });
  return { live, calls, jobs };
}

test("real-time search is one bounded page per selected platform, without score filtering or scheduling", async () => {
  const { live, calls, jobs } = await liveHarness();
  const result = await live.searchLiveTopics(options({ platforms: ["x", "youtube"], range: "week", sort: "latest" }), { TIKHUB_TOKEN: "personal" });
  assert.equal(result.items.length, 2); assert.equal(calls.length, 2);
  for (const { source } of calls) {
    assert.equal(source.config.maxPages, 1); assert.equal(source.config.maxItems, 30);
    assert.equal(source.config.minValueScore, 0); assert.equal(source.enabled, false);
  }
  assert.match(calls[0].source.target, /^Codex since:/);
  assert.equal(calls[0].source.config.searchType, "Latest");
  assert.equal(calls[1].source.config.timeRange, "this_week");
  assert.equal(calls[1].source.config.sortBy, "upload_date");
  assert.equal(jobs.length, 2);
});

test("missing TikHub key skips only paid platforms and one failed platform does not discard others", async () => {
  const noKey = await liveHarness();
  const missing = await noKey.live.searchLiveTopics(options({ platforms: ["x", "github"], range: "month" }), {});
  assert.equal(missing.platforms[0].status, "failed"); assert.equal(missing.platforms[1].status, "succeeded");
  assert.equal(noKey.calls.length, 1); assert.equal(noKey.jobs.length, 1);
  const partial = await liveHarness({ fail: "x" });
  const result = await partial.live.searchLiveTopics(options({ platforms: ["x", "youtube"], range: "month" }), { TIKHUB_TOKEN: "fake-secret-key" });
  assert.equal(result.platforms[0].status, "failed"); assert.equal(result.platforms[1].status, "succeeded");
  assert.equal(result.items.length, 1); assert.doesNotMatch(JSON.stringify(result), /fake-secret-key/);
});

test("TikHub search calls actual existing endpoints once and normalizes X and YouTube results", async () => {
  const calls = [];
  const connector = await load("../lib/connectors/tikhub.ts", { "./helpers": helpers, "../source-config": config,
    "../tikhub-client": { requestTikHub: async (_env, path, params) => {
      calls.push({ path, params });
      return { data: path.includes("twitter")
        ? { tweets: [{ tweet_id: "123", full_text: "Codex tutorial", user: { name: "Builder", screen_name: "builder" } }], next_cursor: "another-page" }
        : { videos: [{ video_id: "abcdefghijk", title: "Codex video", description: "Full description", author: "Creator" }], continuation_token: "another-page" } };
    } } });
  const { live } = await liveHarness();
  for (const platform of ["x", "youtube"]) {
    const source = live.topicSearchSource(platform, options({ range: "month" }));
    const result = await connector.fetchTikHubSource(source, {});
    assert.equal(result.items.length, 1); assert.ok(result.items[0].title.includes("Codex"));
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.search_type, "Top");
  assert.equal(calls[1].params.keyword, "Codex");
  assert.equal(calls[1].params.upload_date, "this_month");
  assert.equal(calls[1].params.type, "video");
});

test("GitHub keyword search uses selected terms, recent pushes, native best match and 30 result limit", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json({ items: [{ id: 42, full_name: "owner/project", owner: { login: "owner", avatar_url: "https://avatars.githubusercontent.com/u/42" },
      html_url: "https://github.com/owner/project", description: "Custom topic", created_at: "2025-01-01", pushed_at: "2026-09-27", stargazers_count: 10, forks_count: 1, open_issues_count: 0 }] });
  });
  const connector = await load("../lib/connectors/github.ts", { "@/db/repository": {} });
  const result = await connector.searchGitHubTopic("VPS", {}, { latest: false, since: "2026-09-01", limit: 30 });
  assert.equal(calls[0].url.searchParams.get("q"), "VPS pushed:>=2026-09-01");
  assert.equal(calls[0].url.searchParams.get("per_page"), "30");
  assert.equal(calls[0].url.searchParams.has("sort"), false);
  assert.equal(result.items[0].externalId, "github-repository-42");
  assert.equal(result.items[0].metrics.starGrowth24h, undefined);
  assert.equal(result.billable, false);
});

async function apiHarness(overrides = {}) {
  const calls = [];
  const route = await load("../app/api/search/route.ts", {
    "@/db/search": { searchStoredContents: async (options) => { calls.push({ stored: options });
      if (overrides.dbFail) throw new Error("Database failed private detail");
      return { items: [], total: 0, page: 1, pageSize: 30, hasMore: false }; } },
    "@/db/repository": { listReviewInboxLinks: async () => [], listRewriteJobsForContents: async () => [] },
    "@/db/runtime": { getAppEnv: async () => ({ DATA_MODE: overrides.mode ?? "demo", TIKHUB_TOKEN: "server-secret" }) },
    "@/lib/live-search": { searchLiveTopics: async (options, env) => { calls.push({ options, env }); return { items: [], platforms: [] }; } },
    "@/lib/topic-search": search, "@/lib/same-origin": origin,
    "@/lib/tikhub-credentials": { readTikHubCredential: async () => overrides.personal ? { apiKey: "personal-secret" } : null },
  });
  return { route, calls };
}

const post = (origin = "http://localhost", body = { query: "Codex", platforms: ["x"], range: "month" }) => new Request("http://localhost/api/search", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("search API rejects cross-origin or invalid paid requests before accessing connectors", async () => {
  const { route, calls } = await apiHarness();
  assert.equal((await route.POST(post("https://evil.example"))).status, 403);
  assert.equal((await route.POST(post("http://localhost", { query: "Codex", platforms: ["linuxdo"] }))).status, 400);
  assert.equal(calls.length, 0);
});

test("live API uses browser personal key first, restricts server key fallback, and never leaks it", async () => {
  for (const [input, expected] of [[{ personal: true }, "personal-secret"], [{ mode: "demo" }, undefined], [{ mode: "live" }, "server-secret"]]) {
    const { route, calls } = await apiHarness(input);
    const response = await route.POST(post());
    assert.equal(response.status, 200); assert.equal(calls[0].env.TIKHUB_TOKEN, expected);
    assert.doesNotMatch(await response.text(), /secret/);
  }
});

test("GET supports repeated platforms, private responses and returns database failures without fake results", async () => {
  const { route, calls } = await apiHarness();
  const request = new Request("http://localhost/api/search?q=Codex&platform=x&platform=youtube&page=2");
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(calls[0].stored.platforms, ["x", "youtube"]); assert.equal(calls[0].stored.page, 2);
  const broken = await apiHarness({ dbFail: true });
  const failed = await broken.route.GET(request);
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private detail|demo|items/);
});

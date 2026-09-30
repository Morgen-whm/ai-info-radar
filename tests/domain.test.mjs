import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const testEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const testContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("health endpoint reports connector readiness without exposing secrets", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "trendhub");
  assert.equal(payload.connectors.linuxdo, true);
  assert.equal(payload.connectors.idcflare, true);
  assert.equal(payload.connectors.gitlab, true);
  assert.equal(JSON.stringify(payload).includes("TIKHUB_TOKEN"), false);
});

test("production build declares the five-minute collection schedule", async () => {
  const config = JSON.parse(
    await readFile(
      new URL("../dist/server/wrangler.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(config.triggers?.crons, ["*/5 * * * *"]);
});

test("cron endpoint fails closed when its production secret is missing", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/internal/cron", { method: "POST" }),
    { ...testEnv, DATA_MODE: "live" },
    testContext,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "定时采集接口尚未配置",
  });
});

test("weekly report API fails closed before database access when its key is missing", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/weekly-reports/latest"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "周报 API 尚未配置",
  });
});

test("production package contains both weekly report D1 tables", async () => {
  const sql = await readFile(
    new URL(
      "../dist/.openai/drizzle/0002_thick_preak.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE `weekly_reports`/);
  assert.match(sql, /CREATE TABLE `weekly_report_items`/);
});

test("author avatars are collected, persisted and rendered with a fallback", async () => {
  const [types, helpers, tikhub, repository, card, avatar, migration] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../lib/connectors/helpers.ts",
        "../lib/connectors/tikhub.ts",
        "../db/repository.ts",
        "../components/ContentCard.tsx",
        "../components/AuthorAvatar.tsx",
        "../drizzle/0003_tired_devos.sql",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /authorAvatarUrl\?: string/);
  assert.match(helpers, /export function avatarFrom/);
  assert.match(helpers, /profile_image_url_https/);
  assert.match(helpers, /channel_thumbnail/);
  assert.match(tikhub, /authorAvatarUrl: avatarFrom\(item, "x"\)/);
  assert.match(tikhub, /authorAvatarUrl: avatarFrom\(item, "youtube"\)/);
  assert.match(repository, /author_avatar_url/);
  assert.match(repository, /avatarFrom\(raw, platform\)/);
  assert.match(card, /src=\{item\.authorAvatarUrl\}/);
  assert.match(avatar, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(migration, /ADD `author_avatar_url` text/);
});

test("dashboard never substitutes fixed demo topics", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/dashboard"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.hotTopics, []);
  assert.equal(payload.stats.hotTopics, 0);
});

test("homepage, topics page and dashboard API no longer import demoTopics", async () => {
  const files = await Promise.all(
    [
      "../app/page.tsx",
      "../app/topics/page.tsx",
      "../app/api/dashboard/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.ok(files.every((source) => !source.includes("demoTopics")));
});

test("light and dark themes are selectable, persistent and initialized before paint", async () => {
  const [layout, toggle, styles] = await Promise.all(
    [
      "../app/layout.tsx",
      "../components/ThemeToggle.tsx",
      "../app/globals.css",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(layout, /localStorage\.getItem\("trendhub-theme"\)/);
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /dangerouslySetInnerHTML/);
  assert.match(toggle, /localStorage\.setItem\(STORAGE_KEY, theme\)/);
  assert.match(toggle, /aria-pressed=\{theme === "light"\}/);
  assert.match(toggle, /aria-pressed=\{theme === "dark"\}/);
  assert.match(styles, /html\[data-theme="light"\]/);
  assert.match(styles, /\.theme-toggle/);
});

test("live topics preserve source links and distinguish signals from corroborated topics", async () => {
  const [types, clustering, page, homepage] = await Promise.all(
    [
      "../lib/types.ts",
      "../lib/live-topics.ts",
      "../app/topics/page.tsx",
      "../app/page.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(types, /kind: "signal" \| "topic"/);
  assert.match(types, /sources: TopicSource\[\]/);
  assert.match(clustering, /sourceUrls\.has\(normalized\)/);
  assert.match(clustering, /distinctContentCount >= 2/);
  assert.match(
    clustering,
    /new Set\(ordered\.map\(\(entry\) => entry\.item\.sourceId\)\)\.size >= 2/,
  );
  assert.match(clustering, /\.slice\(0, 3\)\s*\.map<TopicSource>/);
  assert.match(clustering, /kind: corroborated \? "topic" : "signal"/);
  assert.match(page, /className="topic-title-link"/);
  assert.match(page, /href=\{topic\.sources\[0\]\.url\}/);
  assert.match(page, /topic\.sources\.map\(\(source\)/);
  assert.match(page, /热点线索/);
  assert.match(page, /热点话题/);
  assert.match(page, /X 原帖/);
  assert.match(page, /YouTube 视频/);
  assert.match(page, /Linux\.do 话题/);
  assert.match(page, /target="_blank"/);
  assert.match(homepage, /热点线索/);
  assert.match(homepage, /热点话题/);
});

test("weekly UI refresh rejects cross-site requests before database access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/weekly-reports/refresh-current", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    }),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "只允许站内操作" });
});

test("review writes reject cross-site requests before database access", async () => {
  const worker = await loadWorker();
  for (const [path, method] of [
    ["/api/reviews/cnt-test", "PATCH"],
    ["/api/reviews/cnt-test/draft", "POST"],
    ["/api/reviews/cnt-test/pipeline", "POST"],
    ["/api/reviews/cnt-test/publish", "POST"],
    ["/api/reviews/cnt-test/publish-site", "POST"],
    ["/api/rewrite-candidates/cnt-test", "PUT"],
    ["/api/review-inbox/cnt-test", "PUT"],
  ]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({}),
      }),
      testEnv,
      testContext,
    );
    assert.equal(response.status, 403, path);
    assert.deepEqual(await response.json(), { error: "只允许站内操作" });
  }
});

test("feed links can be saved to a separate persisted review inbox", async () => {
  const [types, schema, runtime, repository, card, feed, review, panel, route, migration] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../db/schema.ts",
        "../db/runtime.ts",
        "../db/repository.ts",
        "../components/ContentCard.tsx",
        "../app/feed/FeedExplorer.tsx",
        "../app/review/page.tsx",
        "../app/review/ReviewInboxPanel.tsx",
        "../app/api/review-inbox/[contentId]/route.ts",
        "../drizzle/0010_slow_master_chief.sql",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /export interface ReviewInboxLink/);
  assert.match(schema, /export const reviewInboxLinks/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS review_inbox_links/);
  assert.match(repository, /export async function saveReviewInboxLink/);
  assert.match(repository, /ON CONFLICT\(content_id\) DO UPDATE/);
  assert.match(card, /存入审核中心/);
  assert.match(card, /aria-pressed=\{inReviewInbox\}/);
  assert.match(feed, /审核收件箱 \{reviewInboxIds\.size\} 条/);
  assert.match(review, /<ReviewInboxPanel links=\{inboxLinks\}/);
  assert.match(panel, /审核收件箱/);
  assert.match(review, /href="#review-inbox"/);
  assert.match(review, /审核收件箱 \$\{inboxLinks\.length\} 条/);
  assert.match(panel, /<code>\{link\.url\}<\/code>/);
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /export async function PUT/);
  assert.match(migration, /CREATE TABLE `review_inbox_links`/);
});

test("feed selections persist as an explicit rewrite candidate queue", async () => {
  const [types, schema, runtime, repository, card, feed, review, route] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../db/schema.ts",
        "../db/runtime.ts",
        "../db/repository.ts",
        "../components/ContentCard.tsx",
        "../app/feed/FeedExplorer.tsx",
        "../app/review/page.tsx",
        "../app/api/rewrite-candidates/[contentId]/route.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /isRewriteCandidate\?: boolean/);
  assert.match(schema, /export const rewriteCandidates/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS rewrite_candidates/);
  assert.match(repository, /setRewriteCandidate/);
  assert.match(repository, /countRewriteCandidates/);
  assert.match(repository, /focus\?: "candidates" \| "knowledge" \| "all"/);
  assert.match(card, /加入改写备选/);
  assert.match(card, /aria-pressed=\{selected\}/);
  assert.match(feed, /改写备选 \{candidateCount\} 条/);
  assert.match(review, /focus: "candidates"/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function DELETE/);
});

test("editorial review uses a persisted evidence-first writing pipeline", async () => {
  const [types, schema, runtime, repository, pipeline, route, workbench, migration] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../db/schema.ts",
        "../db/runtime.ts",
        "../db/repository.ts",
        "../lib/editorial-pipeline.ts",
        "../app/api/reviews/[contentId]/pipeline/route.ts",
        "../app/review/ReviewWorkbench.tsx",
        "../drizzle/0007_small_shatterstar.sql",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /export interface EditorialPipeline/);
  assert.match(types, /relatedMaterials: RelatedEditorialMaterial\[\]/);
  assert.match(types, /evidencePack: EditorialEvidencePack \| null/);
  assert.match(schema, /editorialPipelineJson/);
  assert.match(runtime, /editorial_pipeline_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(repository, /normalizeEditorialPipeline/);
  assert.match(pipeline, /findRelatedEditorialMaterials/);
  assert.match(pipeline, /generateEditorialEvidencePack/);
  assert.match(pipeline, /generateEditorialWritingAngles/);
  assert.match(pipeline, /factCheckEditorialDraft/);
  assert.match(pipeline, /formatChineseEditorialMarkdown/);
  assert.match(route, /"fact-check"/);
  assert.match(route, /requireSameOrigin/);
  assert.match(workbench, /EDITORIAL PIPELINE/);
  assert.match(workbench, /选择独特写作角度/);
  assert.match(workbench, /事实回查/);
  assert.match(migration, /ADD `editorial_pipeline_json` text DEFAULT '\{\}' NOT NULL/);
});

test("GitHub collection persists Star snapshots and emits daily and weekly growth rankings", async () => {
  const [types, schema, runtime, repository, connector, connectors, sources, feed, card, migration] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../db/schema.ts",
        "../db/runtime.ts",
        "../db/repository.ts",
        "../lib/connectors/github.ts",
        "../lib/connectors/index.ts",
        "../lib/demo-data.ts",
        "../app/feed/FeedExplorer.tsx",
        "../components/ContentCard.tsx",
        "../drizzle/0008_futuristic_boom_boom.sql",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /\| "github"/);
  assert.match(types, /starGrowth24h\?: number/);
  assert.match(types, /starGrowth7d\?: number/);
  assert.match(schema, /export const githubStarSnapshots/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS github_star_snapshots/);
  assert.match(repository, /saveGitHubStarSnapshots/);
  assert.match(repository, /getGitHubStarSnapshotMap/);
  assert.match(connector, /\/search\/repositories/);
  assert.match(connector, /rankGrowth/);
  assert.match(connector, /growth >= 200/);
  assert.match(connector, /isMonday\(today\)/);
  assert.match(connectors, /fetchGitHubSource/);
  assert.match(sources, /src-github-ai-star-growth/);
  assert.match(feed, /value: "github", label: "GitHub"/);
  assert.match(card, /昨日 Star/);
  assert.match(card, /上周 Star/);
  assert.match(migration, /CREATE TABLE `github_star_snapshots`/);
});

test("Feishu settings report missing server configuration without exposing secrets", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/settings/feishu"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.configured, false);
  assert.equal(payload.destination, "unconfigured");
  assert.equal(JSON.stringify(payload).includes("FEISHU_APP_SECRET"), false);
});

test("Feishu publishing rebuilds one dedicated document with daily sections", async () => {
  const [feishu, repository, publishRoute, settings, envExample] =
    await Promise.all(
      [
        "../lib/feishu.ts",
        "../db/repository.ts",
        "../app/api/reviews/[contentId]/publish/route.ts",
        "../app/settings/page.tsx",
        "../.env.example",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(feishu, /FEISHU_DAILY_DOCUMENT_ID/);
  assert.match(feishu, /FEISHU_DAILY_WIKI_NODE_TOKEN/);
  assert.match(feishu, /\/wiki\/v2\/spaces\/get_node/);
  assert.match(feishu, /node\.obj_type !== "docx"/);
  assert.match(feishu, /if \(!wikiNodeToken\)/);
  assert.match(feishu, /buildDailyFeishuBlocks/);
  assert.match(feishu, /timeZone: "Asia\/Shanghai"/);
  assert.match(feishu, /demoteArticleHeadings/);
  assert.match(repository, /listPublishedFeishuReviews/);
  assert.match(publishRoute, /listPublishedFeishuReviews/);
  assert.match(settings, /飞书每日精选总文档/);
  assert.match(envExample, /FEISHU_DAILY_DOCUMENT_TITLE/);
  assert.match(envExample, /FEISHU_DAILY_WIKI_NODE_TOKEN/);
  assert.match(settings, /FEISHU_DAILY_WIKI_NODE_TOKEN/);
  assert.match(settings, /飞书每日精选总文档/);
});

test("review center can approve the current draft and upload it to Feishu in one action", async () => {
  const workbench = await readFile(
    new URL("../app/review/ReviewWorkbench.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workbench, /审核后上传到飞书/);
  assert.match(workbench, /approveAndPublishFeishu/);
  assert.match(workbench, /status: "approved"/);
  assert.match(workbench, /\/publish`/);
  assert.match(workbench, /内容已审核通过，但上传飞书失败/);
});

test("review workflow keeps source, editor draft and Feishu publication state separate", async () => {
  const [schema, repository, ai, feishu, migration] = await Promise.all(
    [
      "../db/schema.ts",
      "../db/repository.ts",
      "../lib/ai.ts",
      "../lib/feishu.ts",
      "../drizzle/0004_nosy_mongu.sql",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.match(schema, /sourceSnapshotJson/);
  assert.match(schema, /editorContent/);
  assert.match(schema, /publishedContentHash/);
  assert.match(repository, /ON CONFLICT\(content_id\) DO UPDATE/);
  assert.match(ai, /generateEditorialDraft/);
  assert.match(feishu, /markdownToFeishuBlocks/);
  assert.match(feishu, /replaceDocumentBlocks/);
  assert.match(migration, /CREATE TABLE `content_reviews`/);
});

test("approved editorial copy can publish to the built-in knowledge website", async () => {
  const [types, schema, repository, knowledge, publishRoute, migration, sources] =
    await Promise.all(
      [
        "../lib/types.ts",
        "../db/schema.ts",
        "../db/repository.ts",
        "../lib/knowledge.ts",
        "../app/api/reviews/[contentId]/publish-site/route.ts",
        "../drizzle/0005_long_nebula.sql",
        "../lib/demo-data.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(types, /export interface KnowledgeArticle/);
  assert.match(types, /knowledgeCategory: KnowledgeCategory/);
  assert.match(schema, /export const knowledgeArticles/);
  assert.match(repository, /publishReviewToKnowledgeSite/);
  assert.match(repository, /ON CONFLICT\(content_id\) DO UPDATE/);
  assert.match(knowledge, /inferKnowledgeCategory/);
  assert.match(publishRoute, /review\.status !== "approved"/);
  assert.match(migration, /CREATE TABLE `knowledge_articles`/);
  assert.match(sources, /src-x-codex-skills/);
  assert.match(sources, /src-x-open-source-projects/);
  assert.match(sources, /src-x-overseas-practice/);
  assert.match(sources, /src-yt-tested-tutorials/);
});

test("feed endpoint falls back to clearly defined demo content", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/feed?platform=x&sort=hot&q=codex"),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.total >= 1);
  assert.ok(payload.items.every((item) => item.platform === "x"));
  assert.ok(
    payload.items.some((item) => item.title.toLowerCase().includes("codex")),
  );
});

test("personal TikHub keys are validated and returned only as encrypted HttpOnly cookies", async () => {
  const worker = await loadWorker();
  const apiKey = "tikhub_personal_test_key_123456";
  const originalFetch = globalThis.fetch;
  const originalEncryptionSecret =
    process.env.TIKHUB_KEY_ENCRYPTION_SECRET;
  process.env.TIKHUB_KEY_ENCRYPTION_SECRET =
    "test-only-encryption-secret-with-more-than-24-characters";
  globalThis.fetch = async (input, init) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    if (url === "https://api.tikhub.io/api/v1/tikhub/user/get_user_info") {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${apiKey}`,
      );
      return Response.json({
        code: 200,
        api_key_data: {
          api_key_name: "Team member key",
          expires_at: "2027-01-01T00:00:00Z",
        },
        user_data: {
          email: "member@example.com",
          balance: 12.34,
          free_credit: 0.5,
        },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const env = testEnv;
    const saveResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ apiKey }),
      }),
      env,
      testContext,
    );
    assert.equal(saveResponse.status, 200);
    const setCookie = saveResponse.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.doesNotMatch(setCookie, new RegExp(apiKey));

    const savePayload = await saveResponse.json();
    assert.equal(savePayload.configured, true);
    assert.equal(savePayload.keyHint, "•••• 3456");
    assert.equal(JSON.stringify(savePayload).includes(apiKey), false);
    assert.equal(
      JSON.stringify(savePayload).includes("member@example.com"),
      false,
    );

    const cookie = setCookie.split(";")[0];
    const statusResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        headers: { cookie },
      }),
      env,
      testContext,
    );
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.configured, true);
    assert.equal(statusPayload.keyHint, "•••• 3456");
    assert.equal(JSON.stringify(statusPayload).includes(apiKey), false);

    const deleteResponse = await worker.fetch(
      new Request("http://localhost/api/settings/tikhub", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
      env,
      testContext,
    );
    assert.equal(deleteResponse.status, 200);
    assert.match(deleteResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionSecret === undefined) {
      delete process.env.TIKHUB_KEY_ENCRYPTION_SECRET;
    } else {
      process.env.TIKHUB_KEY_ENCRYPTION_SECRET = originalEncryptionSecret;
    }
  }
});

test("one-click knowledge rewrite is versioned, source-enriched, resumable and review-only", async () => {
  const [
    types,
    profile,
    enrichment,
    schema,
    runtime,
    migration,
    jobs,
    createRoute,
    card,
    markdown,
    pipeline,
  ] = await Promise.all(
    [
      "../lib/types.ts",
      "../lib/editorial-profiles/knowledge-base-writing-v1.ts",
      "../lib/source-enrichment.ts",
      "../db/schema.ts",
      "../db/runtime.ts",
      "../drizzle/0009_unique_hemingway.sql",
      "../lib/rewrite-jobs.ts",
      "../app/api/rewrite-jobs/route.ts",
      "../components/ContentCard.tsx",
      "../components/MarkdownArticle.tsx",
      "../lib/editorial-pipeline.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(profile, /version: "2026-08-31\.v2"/);
  assert.match(types, /export interface EditorialSourceBundle/);
  assert.match(enrichment, /fetch_tweet_detail/);
  assert.match(enrichment, /fetch_post_comments/);
  assert.match(enrichment, /get_video_info_v2/);
  assert.match(enrichment, /get_video_captions_result/);
  assert.match(schema, /export const rewriteJobs/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS rewrite_jobs/);
  assert.match(migration, /CREATE TABLE `rewrite_jobs`/);
  assert.match(createRoute, /AI_API_KEY/);
  assert.match(card, /按知识库标准一键改写/);
  assert.match(card, /advanceRewriteJob/);
  assert.match(markdown, /figcaption/);
  assert.match(pipeline, /getUsableEditorialVisuals/);
  assert.match(pipeline, /已插入来源中最重要的真实配图/);
  assert.match(enrichment, /opengraph\.githubassets\.com/);
  assert.match(pipeline, /thinking: \{ type: "disabled" \}/);
  assert.match(pipeline, /response_format: \{ type: "json_object" \}/);
  assert.match(pipeline, /sourceAliases/);
  assert.match(pipeline, /aliasToSourceId/);
  assert.match(jobs, /stage: "human_review"/);
  assert.match(jobs, /status: "pending"/);
  assert.doesNotMatch(jobs, /publishReviewToKnowledgeSite|publishReviewToFeishu/);
});

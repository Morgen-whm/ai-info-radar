import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const content = await load("../lib/wechat-content.ts");
const origin = await load("../lib/same-origin.ts");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVWsAAAAASUVORK5CYII=", "base64");
const IMAGE = "https://pbs.twimg.com/media/example.png";
const article = { title: "把有用的信息留下来", digest: "从信息筛选到实际使用。", author: "雷达编辑", bodyMarkdown: `从一个具体问题开始。\n\n## 让知识派上用场\n\n保存必要细节，再决定下一步。\n\n![项目界面](${IMAGE})`, coverUrl: IMAGE };
const env = { WECHAT_APP_ID: "account-a", WECHAT_APP_SECRET: "fake-secret", AI_API_KEY: "fake-ai-key" };

async function harness(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) }, success: true }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const runtime = await load("../db/runtime.ts");
  const review = { contentId: "test-article", editorTitle: "知识库原稿", editorContent: article.bodyMarkdown, editorialPipeline: {} };
  const original = structuredClone(review);
  const repository = { getDatabase: async () => db, getContentReview: async () => review };
  const store = await load("../db/wechat.ts", { "./repository": repository, "./runtime": runtime, "@/lib/wechat-content": content });
  const api = await load("../lib/wechat.ts", { "@/db/wechat": store, "./wechat-content": content });
  const writing = await load("../lib/wechat-writing.ts", { "@/db/wechat": store, "./wechat-content": content });
  const workflow = await load("../lib/wechat-workflow.ts", {
    "@/db/repository": repository, "@/db/wechat": store, "./wechat-content": content, "./wechat": api, "./wechat-writing": writing,
  });
  return { db, sqlite, review, original, store, api, writing, workflow };
}

function remote(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.hostname === "api.deepseek.com") return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(article) } }] });
    if (url.hostname === "pbs.twimg.com") return new Response(PNG);
    assert.equal(url.hostname, "api.weixin.qq.com");
    const path = url.pathname.replace("/cgi-bin/", "");
    assert.ok(!path.includes("publish") && !path.includes("mass"), "never publish or send to followers");
    if (overrides[path]) return overrides[path](init, calls);
    switch (path) {
      case "stable_token": assert.equal(JSON.parse(init.body).force_refresh, false); return Response.json({ access_token: "fake-access-token", expires_in: 7200 });
      case "media/uploadimg": assert.ok(init.body instanceof FormData); return Response.json({ url: "http://mmbiz.qpic.cn/test/article.png" });
      case "material/add_material": assert.equal(url.searchParams.get("type"), "image"); return Response.json({ media_id: "permanent-cover" });
      case "draft/add": return Response.json({ media_id: "draft-123" });
      case "draft/get": return Response.json({ news_item: [{ title: article.title }] });
      case "draft/update": return Response.json({ errcode: 0 });
      default: throw new Error(`Unexpected outbound API ${path}`);
    }
  });
  return calls;
}

test("HTML formatting escapes executable markup and preserves useful article structure", () => {
  const html = content.renderWechatHtml(`## 标题\n\n**重要** 和 [链接](https://example.com)\n\n<script>alert(1)</script>\n\n![图](${IMAGE})\n\n\`\`\`js\n<a>example</a>\n\`\`\``, { [IMAGE]: "https://mmbiz.qpic.cn/ok.png" });
  assert.match(html, /<h2/); assert.match(html, /<strong>重要<\/strong>/);
  assert.doesNotMatch(html, /<script|<a\b/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /src="https:\/\/mmbiz.qpic.cn\/ok.png"/);
  assert.match(html, /&lt;a&gt;example&lt;\/a&gt;/);
});

test("validation covers length, inline images, unsafe protocols and missing real images", () => {
  assert.deepEqual(content.validateWechatArticle(article, true), []);
  assert.match(content.validateWechatArticle({ ...article, title: "字".repeat(33) }).join(), /32/);
  assert.match(content.validateWechatArticle({ ...article, digest: "字".repeat(121) }).join(), /120/);
  assert.match(content.validateWechatArticle({ ...article, bodyMarkdown: `段落 ![图](${IMAGE})` }).join(), /单独占一行/);
  assert.match(content.validateWechatArticle({ ...article, coverUrl: "javascript:alert(1)" }).join(), /HTTPS/);
  assert.match(content.validateWechatArticle({ ...article, bodyMarkdown: "只有文字", coverUrl: "" }, true).join(), /封面.*真实图片/);
  assert.equal(content.articleImages(`\`\`\`\n![示例](${IMAGE})\n\`\`\``).length, 0);
});

test("image fetching rejects internal hosts and unsafe redirects; image bytes and size are checked", async (t) => {
  const { api } = await harness(t);
  assert.equal(api.inspectWechatImage(PNG).mime, "image/png");
  assert.throws(() => api.inspectWechatImage(new Uint8Array(1_000_000)), /1 MB/);
  assert.throws(() => api.inspectWechatImage(new TextEncoder().encode("<svg/>")), /JPG/);
  for (const url of ["http://pbs.twimg.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a", "https://pbs.twimg.com.evil.test/a", "https://me:secret@pbs.twimg.com/a"]) assert.throws(() => api.allowedImageUrl(url, env));
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  await assert.rejects(api.readWechatImage(IMAGE, env), /未获允许/);
});

test("generation creates an independent version; add/update/no-op sync preserve knowledge original", async (t) => {
  const { workflow, store, review, original } = await harness(t);
  const calls = remote(t);
  const generated = await workflow.generateWechatVersion(review.contentId, 0, env);
  assert.equal(generated.title, article.title); assert.equal(generated.status, "draft");
  assert.deepEqual(review, original);
  let draft = await workflow.syncWechatVersion(review.contentId, generated.version, env);
  assert.equal(draft.mediaId, "draft-123"); assert.equal(draft.status, "synced");
  const submitted = JSON.parse(calls.find((call) => call.url.pathname.endsWith("draft/add")).init.body).articles[0];
  assert.equal(submitted.thumb_media_id, "permanent-cover");
  assert.match(submitted.content, /mmbiz.qpic.cn/); assert.doesNotMatch(submitted.content, /pbs.twimg.com/);
  assert.equal(submitted.content_source_url, undefined);
  assert.equal(submitted.cover_info.crop_percent_list.length, 2);
  draft = await workflow.syncWechatVersion(review.contentId, draft.version, env);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("draft/add")).length, 1);
  const edited = await workflow.editWechatVersion(review.contentId, draft.version, { ...article, title: "人工编辑后的标题" });
  assert.equal(edited.status, "draft");
  draft = await workflow.syncWechatVersion(review.contentId, edited.version, env);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("draft/update")).length, 1);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("media/uploadimg")).length, 1);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("material/add_material")).length, 1);
  assert.equal((await store.listWechatLogs(review.contentId)).length, 3);
  assert.deepEqual(review, original);
});

test("stale edits and concurrent operations cannot overwrite a draft or duplicate remote submission", async (t) => {
  const { store, workflow, review } = await harness(t);
  remote(t);
  const generated = await workflow.generateWechatVersion(review.contentId, 0, env);
  await assert.rejects(workflow.editWechatVersion(review.contentId, 0, article), /已变化/);
  const results = await Promise.allSettled([
    workflow.syncWechatVersion(review.contentId, generated.version, env),
    workflow.syncWechatVersion(review.contentId, generated.version, env),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await store.getWechatDraft(review.contentId)).operation, "");
});

test("draft/add network ambiguity blocks automatic retry, persists result and allows explicit reconciliation", async (t) => {
  const { store, workflow, review } = await harness(t);
  let commits = 0;
  remote(t, { "draft/add": () => { commits++; throw new TypeError("network failed with fake-access-token"); } });
  const generated = await workflow.generateWechatVersion(review.contentId, 0, env);
  await assert.rejects(workflow.syncWechatVersion(review.contentId, generated.version, env), /结果不明/);
  let draft = await store.getWechatDraft(review.contentId);
  assert.equal(draft.status, "unknown"); assert.doesNotMatch(draft.message, /fake-access-token/);
  await assert.rejects(workflow.syncWechatVersion(review.contentId, draft.version, env), /结果不明/);
  assert.equal(commits, 1);
  await assert.rejects(workflow.reconcileWechatVersion(review.contentId, draft.version, "", false, env), /明确确认/);
  draft = await workflow.reconcileWechatVersion(review.contentId, draft.version, "draft-123", false, env);
  assert.equal(draft.mediaId, "draft-123"); assert.equal(draft.status, "draft");
  draft = await workflow.syncWechatVersion(review.contentId, draft.version, env);
  assert.equal(draft.status, "synced"); assert.equal(commits, 1);
});

test("permission failures are explicit and secrets are not echoed", async (t) => {
  const { workflow, store, review } = await harness(t);
  remote(t, { "draft/add": () => Response.json({ errcode: 48001, errmsg: "secret=fake-secret&access_token=fake-access-token" }) });
  const generated = await workflow.generateWechatVersion(review.contentId, 0, env);
  await assert.rejects(workflow.syncWechatVersion(review.contentId, generated.version, env), /没有此接口权限/);
  const draft = await store.getWechatDraft(review.contentId);
  assert.equal(draft.status, "failed"); assert.doesNotMatch(draft.message, /fake-secret|fake-access-token/);
  const logs = await store.listWechatLogs(review.contentId);
  assert.equal(logs[0].status, "failed");
});

test("partial image uploads are reused after a definite failure, without creating a premature draft", async (t) => {
  const { workflow, store, review } = await harness(t);
  let coverAttempts = 0;
  const calls = remote(t, { "material/add_material": () => ++coverAttempts === 1
    ? Response.json({ errcode: 40009, errmsg: "invalid size" })
    : Response.json({ media_id: "permanent-cover" }) });
  let draft = await workflow.generateWechatVersion(review.contentId, 0, env);
  await assert.rejects(workflow.syncWechatVersion(review.contentId, draft.version, env), /图片大小/);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("draft/add")).length, 0);
  draft = await store.getWechatDraft(review.contentId);
  assert.ok(draft.imageCache[IMAGE]);
  draft = await workflow.syncWechatVersion(review.contentId, draft.version, env);
  assert.equal(draft.status, "synced");
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("media/uploadimg")).length, 1);
});

test("malformed update acknowledgements are unknown, never reported as synced", async (t) => {
  const { workflow, store, review } = await harness(t);
  remote(t, { "draft/update": () => Response.json({}) });
  let draft = await workflow.generateWechatVersion(review.contentId, 0, env);
  draft = await workflow.syncWechatVersion(review.contentId, draft.version, env);
  draft = await workflow.editWechatVersion(review.contentId, draft.version, { ...article, title: "修改标题" });
  await assert.rejects(workflow.syncWechatVersion(review.contentId, draft.version, env), /未确认/);
  assert.equal((await store.getWechatDraft(review.contentId)).status, "unknown");
});

test("missing AI key never generates a template or destroys existing version", async (t) => {
  const { workflow, store, review, original } = await harness(t);
  remote(t);
  const before = await workflow.generateWechatVersion(review.contentId, 0, env);
  await assert.rejects(workflow.generateWechatVersion(review.contentId, before.version, {}), /AI_API_KEY/);
  const after = await store.getWechatDraft(review.contentId);
  assert.equal(after.bodyMarkdown, before.bodyMarkdown); assert.equal(after.title, before.title);
  assert.deepEqual(review, original);
});

test("invented media, lost images and truncated model output are rejected", async (t) => {
  const { writing, review } = await harness(t);
  let response = { choices: [{ finish_reason: "length", message: { content: "{}" } }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  await assert.rejects(writing.generateWechatArticle(review, env), /截断/);
  response = { choices: [{ message: { content: JSON.stringify({ ...article, coverUrl: "https://example.com/invented.png" }) } }] };
  await assert.rejects(writing.generateWechatArticle(review, env), /不存在的图片/);
  response = { choices: [{ message: { content: JSON.stringify({ ...article, bodyMarkdown: "没有图片的正文" }) } }] };
  await assert.rejects(writing.generateWechatArticle(review, env), /遗漏/);
});

test("different accounts cannot reuse linked media, and dead workers release into protected state", async (t) => {
  const { workflow, store, sqlite, review } = await harness(t);
  remote(t);
  let draft = await workflow.generateWechatVersion(review.contentId, 0, env);
  draft = await workflow.syncWechatVersion(review.contentId, draft.version, env);
  await assert.rejects(workflow.syncWechatVersion(review.contentId, draft.version, { ...env, WECHAT_APP_ID: "account-b" }), /另一个公众号/);
  draft = await store.getWechatDraft(review.contentId);
  await store.lockWechatDraft(review.contentId, draft.version, "syncing");
  sqlite.prepare("UPDATE wechat_drafts SET updated_at = '2000-01-01T00:00:00.000Z' WHERE content_id = ?").run(review.contentId);
  draft = await store.getWechatDraft(review.contentId);
  assert.equal(draft.operation, ""); assert.equal(draft.status, "unknown");
});

test("API enforces same-origin, explicit editorial confirmation and bounded versions before external writes", async () => {
  let called = 0;
  const { WechatError } = await load("../db/wechat.ts", { "./repository": {}, "./runtime": {}, "@/lib/wechat-content": content });
  const route = await load("../app/api/reviews/[contentId]/wechat/route.ts", {
    "@/db/runtime": { getAppEnv: async () => env }, "@/db/wechat": { WechatError },
    "@/lib/same-origin": origin, "@/lib/wechat": {},
    "@/lib/wechat-workflow": { syncWechatVersion: async () => { called++; } },
  });
  const context = { params: Promise.resolve({ contentId: "a" }) };
  const request = (headers, body) => new Request("http://localhost/api/reviews/a/wechat", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({}, { version: 0, action: "sync", reviewConfirmed: true }), context)).status, 403);
  assert.equal((await route.POST(request({ origin: "http://localhost" }, { version: 0, action: "sync" }), context)).status, 400);
  assert.equal((await route.POST(request({ origin: "http://localhost" }, { version: -1, action: "sync", reviewConfirmed: true }), context)).status, 400);
  assert.equal(called, 0);
});

test("local image uploads are persisted, MIME checked and read without arbitrary file access", async (t) => {
  const { store, api } = await harness(t);
  const upload = await load("../app/api/wechat/assets/route.ts", { "@/db/wechat": store, "@/lib/same-origin": origin, "@/lib/wechat": api, "@/lib/wechat-content": content });
  const get = await load("../app/api/wechat/assets/[id]/route.ts", { "@/db/wechat": store, "@/lib/same-origin": origin });
  const data = new FormData(); data.append("image", new Blob([PNG], { type: "image/png" }), "actual.png");
  const response = await upload.POST(new Request("http://localhost/api/wechat/assets", { method: "POST", headers: { origin: "http://localhost" }, body: data }));
  assert.equal(response.status, 200);
  const { url } = await response.json();
  const image = await get.GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id: url.split("/").at(-1) }) });
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  const invalid = await get.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "../../.env.local" }) });
  assert.equal(invalid.status, 404);
});

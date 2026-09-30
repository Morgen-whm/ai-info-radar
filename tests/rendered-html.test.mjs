import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
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

test("server-renders the TrendHub dashboard", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    testEnv,
    testContext,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>实时总览 · TrendHub<\/title>/i);
  assert.match(html, /实时 AI 情报雷达/);
  assert.match(html, /X、YouTube、Linux\.do、IDCFlare、GitLab 与 GitHub/);
  assert.match(html, /Codex/);
  assert.match(html, /AI 摘要/);
  assert.match(html, /AI Builder Watch 的头像/);
  assert.match(html, /一键采集全部/);
  assert.match(html, /切换到日间浅色主题/);
  assert.match(html, /切换到夜间深色主题/);
  assert.match(html, /LOCAL/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the main product routes", async () => {
  const worker = await loadWorker();
  for (const [path, expected] of [
    ["/feed", "实时信息流"],
    ["/search", "你想研究什么话题"],
    ["/topics", "热点话题"],
    ["/weekly", "AI 周报"],
    ["/review", "内容审核中心"],
    ["/knowledge", "把一手信息，整理成真正能用的知识"],
    ["/sources", "一键采集全部"],
    ["/jobs", "采集任务"],
    ["/settings", "系统设置"],
  ]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        headers: { accept: "text/html" },
      }),
      testEnv,
      testContext,
    );
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), new RegExp(expected), path);
  }
});

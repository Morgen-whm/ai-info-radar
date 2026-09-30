import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Execute the actual TypeScript modules with bounded, in-memory connector
// doubles: these tests never touch the user's database or paid collection APIs.
async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const protocol = await loadModule("../lib/collection-progress.ts");
const summary = protocol.summarizeCollection([
  { sourceId: "1", sourceName: "测试来源", ok: true, itemsAdded: 7 },
  { sourceId: "2", sourceName: "另一个来源", ok: false, error: "连接失败" },
]);
const progress = {
  type: "progress", total: 2, completed: 1, currentSourceName: "测试来源",
  succeeded: 1, failed: 0, itemsAdded: 7,
};

test("stream emits progress before completion and returns final mixed results", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const received = [];
  const response = protocol.collectionProgressResponse(async (emit) => {
    emit(progress);
    await gate;
    return summary;
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform");
  const result = protocol.readCollectionResponse(response, (event) => {
    received.push(event);
    finish();
  });
  assert.deepEqual((await result).results, summary.results);
  assert.equal(received.length, 1);
});

test("UTF-8 and JSON split across chunks, heartbeats and final line without newline work", async () => {
  const data = new TextEncoder().encode([
    progress, { type: "heartbeat" }, { type: "complete", ...summary },
  ].map(JSON.stringify).join("\n"));
  const response = new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < data.length; index += 7) {
        controller.enqueue(data.slice(index, index + 7));
      }
      controller.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const received = [];
  let activity = 0;
  const result = await protocol.readCollectionResponse(response, (event) => received.push(event), () => activity++);
  assert.equal(result.itemsAdded, 7);
  assert.equal(received[0].currentSourceName, "测试来源");
  assert.ok(activity > 1);
});

test("completion resets the client without waiting for the server to close the connection", { timeout: 1000 }, async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "complete", ...summary })}\n`));
      // Intentionally leave the connection open.
    },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const result = await protocol.readCollectionResponse(response, () => {});
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(canceled, true);
});

test("closed progress stream without a completion event is not a successful collection", async () => {
  const response = new Response(`${JSON.stringify(progress)}\n`, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  await assert.rejects(protocol.readCollectionResponse(response, () => {}), /未收到完成确认/);
});

test("server failures and old JSON responses remain readable", async () => {
  const failed = protocol.collectionProgressResponse(async () => { throw new Error("数据库暂不可用"); });
  await assert.rejects(protocol.readCollectionResponse(failed, () => {}), /数据库暂不可用/);
  const result = await protocol.readCollectionResponse(Response.json(summary), () => {});
  assert.deepEqual(result, summary);
  await assert.rejects(protocol.readCollectionResponse(Response.json({ error: "不可用" }, { status: 503 }), () => {}), /不可用/);
});

test("slow sources send heartbeats while collection is pending", { timeout: 1000 }, async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const response = protocol.collectionProgressResponse(async () => {
    await gate;
    return summary;
  }, 5);
  const reader = response.body.getReader();
  const { value } = await reader.read();
  assert.equal(JSON.parse(new TextDecoder().decode(value)).type, "heartbeat");
  finish();
  await reader.cancel();
});

test("batch API streams all source outcomes and preserves the JSON API", async () => {
  const sources = [
    { id: "rss", name: "Linux.do", platform: "linuxdo", enabled: true },
    { id: "x", name: "X", platform: "x", enabled: true },
    { id: "github", name: "GitHub", platform: "github", enabled: true },
    { id: "disabled", name: "未启用", platform: "gitlab", enabled: false },
  ];
  const calls = [];
  const route = await loadModule("../app/api/sync/all/route.ts", {
    "@/db/repository": { listSources: async () => sources },
    "@/db/runtime": { getAppEnv: async () => ({ DATA_MODE: "demo" }) },
    "@/lib/sync": {
      isGitHubDailyDue: () => false,
      syncSourceById: async (id, env, options) => {
        calls.push({ id, env, options });
        return { itemsFound: 12, itemsAdded: 8 };
      },
    },
    "@/lib/tikhub-credentials": { readTikHubCredential: async () => null },
    "@/lib/collection-progress": protocol,
  });
  const events = [];
  const response = await route.POST(new Request("http://localhost/api/sync/all", {
    method: "POST",
    headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
    body: JSON.stringify({ linuxFeeds: { rss: "<rss/>" } }),
  }));
  const result = await protocol.readCollectionResponse(response, (event) => events.push(event));
  assert.equal(events[0].completed, 0);
  assert.equal(events.at(-1).completed, 3);
  assert.equal(events.at(-1).total, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.itemsAdded, 8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.linuxRssXml, "<rss/>");
  const json = await route.POST(new Request("http://localhost/api/sync/all", { method: "POST" }));
  const { type: _type, ...streamSummary } = result;
  assert.equal(_type, "complete");
  assert.deepEqual(await json.json(), streamSummary);
});

test("one failed connector does not stop later source progress", async () => {
  const route = await loadModule("../app/api/sync/all/route.ts", {
    "@/db/repository": { listSources: async () => [
      { id: "1", name: "失败来源", platform: "gitlab", enabled: true },
      { id: "2", name: "成功来源", platform: "gitlab", enabled: true },
    ] },
    "@/db/runtime": { getAppEnv: async () => ({}) },
    "@/lib/sync": {
      isGitHubDailyDue: () => true,
      syncSourceById: async (id) => {
        if (id === "1") throw new Error("连接超时");
        return { itemsFound: 4, itemsAdded: 3 };
      },
    },
    "@/lib/tikhub-credentials": { readTikHubCredential: async () => null },
    "@/lib/collection-progress": protocol,
  });
  const response = await route.POST(new Request("http://localhost/api/sync/all", {
    method: "POST", headers: { Accept: "application/x-ndjson" },
  }));
  const events = [];
  const result = await protocol.readCollectionResponse(response, (event) => events.push(event));
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.itemsAdded, 3);
  assert.equal(events.at(-1).completed, 2);
});

test("client clears a stalled progress request instead of spinning indefinitely", async (t) => {
  const client = await loadModule("../lib/client-sync.ts", { "./collection-progress": protocol });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const pending = client.collectAllSources({}, () => {});
  t.mock.timers.tick(90_001);
  await assert.rejects(pending, /进度连接超时/);
  assert.equal(signal.aborted, true);
});

test("jobs API never masks database errors with demo or cached running jobs", async () => {
  const route = await loadModule("../app/api/jobs/route.ts", {
    "@/db/repository": { listJobs: async () => { throw new Error("offline"); } },
  });
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).jobs, undefined);
});

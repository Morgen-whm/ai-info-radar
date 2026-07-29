import type { AppEnv } from "@/db/runtime";
import {
  createJob,
  finishJob,
  getSource,
  listSources,
  markSourceSynced,
  upsertContent,
} from "@/db/repository";
import { summarizeContent } from "./ai";
import { fetchSource } from "./connectors";
import { getSourceCollectionConfig } from "./source-config";
import { calculateContentValueScore } from "./content-value";

export async function syncSourceById(
  sourceId: string,
  env: AppEnv,
  options: { linuxRssXml?: string } = {},
) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("数据源不存在");
  if (!source.enabled) throw new Error("数据源已暂停");

  const job = await createJob(source);
  const started = Date.now();
  try {
    const result = await fetchSource(source, env, options);
    let added = 0;
    const { maxItems, minValueScore } = getSourceCollectionConfig(source);
    const candidates = result.items.slice(0, maxItems);
    const accepted = candidates.filter(
      (item) => calculateContentValueScore(item) >= minValueScore,
    );
    for (const item of accepted) {
      const summary = await summarizeContent(item, env);
      if (await upsertContent(source.id, item, summary)) added += 1;
    }
    const durationMs = Date.now() - started;
    await finishJob(job.id, {
      status: "succeeded",
      itemsFound: result.items.length,
      itemsAdded: added,
      durationMs,
      requestId: result.requestId,
      billable: result.billable,
    });
    await markSourceSynced(source.id, added);
    return {
      jobId: job.id,
      sourceId: source.id,
      itemsFound: result.items.length,
      itemsAccepted: accepted.length,
      itemsAdded: added,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知采集错误";
    await finishJob(job.id, {
      status: "failed",
      itemsFound: 0,
      itemsAdded: 0,
      durationMs: Date.now() - started,
      errorMessage: message,
    });
    await markSourceSynced(
      source.id,
      0,
      message.includes("403") || message.includes("429") ? "warning" : "paused",
    );
    throw error;
  }
}

export async function syncAllDueSources(env: AppEnv) {
  const sources = (await listSources()).filter((source) => source.enabled);
  const results: Array<{
    sourceId: string;
    ok: boolean;
    skipped?: boolean;
    itemsAdded?: number;
    error?: string;
  }> = [];

  for (const source of sources) {
    const last = source.lastSyncedAt
      ? new Date(source.lastSyncedAt).getTime()
      : 0;
    const due = Date.now() - last >= source.intervalMinutes * 60_000;
    if (!due) continue;
    const needsServerTikHubToken =
      source.platform === "x" || source.platform === "youtube";
    if (needsServerTikHubToken && !env.TIKHUB_TOKEN) {
      results.push({
        sourceId: source.id,
        ok: true,
        skipped: true,
        error: "未配置服务端 TikHub Token，已跳过后台采集",
      });
      continue;
    }
    try {
      const result = await syncSourceById(source.id, env);
      results.push({
        sourceId: source.id,
        ok: true,
        itemsAdded: result.itemsAdded,
      });
    } catch (error) {
      results.push({
        sourceId: source.id,
        ok: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  }
  return results;
}

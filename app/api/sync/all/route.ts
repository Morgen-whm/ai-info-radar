import { listSources } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { isGitHubDailyDue, syncSourceById } from "@/lib/sync";
import { readTikHubCredential } from "@/lib/tikhub-credentials";
import {
  collectionProgressResponse,
  summarizeCollection,
  type CollectionEvent,
  type CollectionResult,
} from "@/lib/collection-progress";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let linuxFeeds: Record<string, string> = {};
  try {
    const payload = (await request.json()) as {
      linuxFeeds?: Record<string, string>;
    };
    if (payload.linuxFeeds && typeof payload.linuxFeeds === "object") {
      linuxFeeds = payload.linuxFeeds;
    }
  } catch {
    // The endpoint also accepts an empty POST body.
  }
  const env = await getAppEnv();
  const personalCredential = await readTikHubCredential(
    request.headers.get("cookie"),
    env,
  );
  const sources = (await listSources()).filter((source) => source.enabled);
  async function collect(emit: (event: CollectionEvent) => void = () => {}) {
    const results: CollectionResult[] = [];
    const progress = (currentSourceName?: string) => {
      const { succeeded, failed, itemsAdded } = summarizeCollection(results);
      emit({
        type: "progress",
        total: sources.length,
        completed: results.length,
        currentSourceName,
        succeeded,
        failed,
        itemsAdded,
      });
    };

    for (const source of sources) {
      progress(source.name);
      if (
        source.platform === "github" &&
        !isGitHubDailyDue(source.lastSyncedAt)
      ) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          itemsFound: 0,
          itemsAdded: 0,
          error: "今日 Star 快照已完成，批量采集已跳过",
        });
        progress();
        continue;
      }
      const isTikHub =
        source.platform === "x" || source.platform === "youtube";
      const token =
        personalCredential?.apiKey ||
        (env.DATA_MODE === "live" ? env.TIKHUB_TOKEN : undefined);
      if (isTikHub && !token) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          error: "未配置 TikHub API Key",
        });
        progress();
        continue;
      }
      try {
        const result = await syncSourceById(
          source.id,
          isTikHub ? { ...env, TIKHUB_TOKEN: token } : env,
          {
            linuxRssXml:
              source.platform === "linuxdo" &&
              typeof linuxFeeds[source.id] === "string"
                ? linuxFeeds[source.id]
                : undefined,
          },
        );
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          itemsFound: result.itemsFound,
          itemsAdded: result.itemsAdded,
        });
      } catch (error) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          error: error instanceof Error ? error.message : "同步失败",
        });
      }
      progress();
    }

    return summarizeCollection(results);
  }

  if (request.headers.get("Accept")?.includes("application/x-ndjson")) {
    return collectionProgressResponse(collect);
  }
  return Response.json(await collect());
}

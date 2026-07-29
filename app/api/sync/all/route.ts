import { listSources } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { syncSourceById } from "@/lib/sync";
import { readTikHubCredential } from "@/lib/tikhub-credentials";

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
  const results: Array<{
    sourceId: string;
    sourceName: string;
    ok: boolean;
    itemsFound?: number;
    itemsAdded?: number;
    error?: string;
  }> = [];

  for (const source of sources) {
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
  }

  return Response.json({
    results,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    itemsAdded: results.reduce((sum, item) => sum + (item.itemsAdded ?? 0), 0),
  });
}

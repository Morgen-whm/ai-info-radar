import type { Source } from "./types";
import { readCollectionResponse, type CollectionProgress } from "./collection-progress";

const localProxyUrl = "http://127.0.0.1:4317/rss";
const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

function canUseLocalProxy(): boolean {
  return (
    typeof window !== "undefined" &&
    localHostnames.has(window.location.hostname)
  );
}

export async function loadLinuxRss(source: Source): Promise<string | undefined> {
  if (source.platform !== "linuxdo" || !canUseLocalProxy()) return undefined;
  try {
    const url = new URL(localProxyUrl);
    url.searchParams.set("url", source.target);
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml" },
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) return undefined;
    const xml = await response.text();
    return xml.includes("<rss") || xml.includes("<feed") ? xml : undefined;
  } catch {
    // The local proxy is an optimization. The server connector still has
    // direct RSS and read-only fallbacks for local and hosted environments.
    return undefined;
  }
}

export async function loadLinuxFeeds(
  sources: Source[],
): Promise<Record<string, string>> {
  const feeds: Record<string, string> = {};
  await Promise.all(
    sources
      .filter((source) => source.enabled && source.platform === "linuxdo")
      .map(async (source) => {
        const xml = await loadLinuxRss(source);
        if (xml) feeds[source.id] = xml;
      }),
  );
  return feeds;
}

export async function collectAllSources(
  linuxFeeds: Record<string, string>,
  onProgress: (progress: CollectionProgress) => void,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), 90_000);
  };
  resetTimeout();
  try {
    const response = await fetch("/api/sync/all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({ linuxFeeds }),
      signal: controller.signal,
      cache: "no-store",
    });
    return await readCollectionResponse(response, onProgress, resetTimeout);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("采集进度连接超时，后台可能仍在处理；请查看采集任务，勿重复提交");
    }
    throw error;
  } finally {
    clearTimeout(timeout!);
  }
}

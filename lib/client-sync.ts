import type { Source } from "./types";

const localProxyUrl = "http://127.0.0.1:4317/rss";

export async function loadLinuxRss(source: Source): Promise<string | undefined> {
  if (source.platform !== "linuxdo") return undefined;
  const url = new URL(localProxyUrl);
  url.searchParams.set("url", source.target);
  const response = await fetch(url, {
    headers: { Accept: "application/rss+xml" },
  });
  if (!response.ok) {
    throw new Error(`Linux.do 本地 RSS 代理返回 HTTP ${response.status}`);
  }
  const xml = await response.text();
  if (!xml.includes("<rss") && !xml.includes("<feed")) {
    throw new Error("Linux.do 本地 RSS 代理返回内容无效");
  }
  return xml;
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

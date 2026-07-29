import { XMLParser } from "fast-xml-parser";
import type { ConnectorResult, NormalizedContentInput, Source } from "../types";
import { normalizeDate, stripHtml } from "./helpers";
import { getSourceCollectionConfig } from "../source-config";
import type { AppEnv } from "@/db/runtime";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const textValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return textValue(item["#text"] ?? item.__cdata ?? "");
  }
  return "";
};

const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function linuxTags(title: string, body: string): string[] {
  return [
    "Linux.do",
    ...["AI", "大模型", "LLM", "Claude", "GPT", "Codex", "Agent", "VPS", "U币", "开卡", "API"]
      .filter((tag) =>
        `${title} ${body}`.toLowerCase().includes(tag.toLowerCase()),
      )
      .slice(0, 7),
  ];
}

function parseJinaFallback(
  markdown: string,
  source: Source,
): NormalizedContentInput[] {
  const { maxItems, filterKeywords } = getSourceCollectionConfig(source);
  const keywords = filterKeywords
    .split(/[,，\n]/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const pattern =
    /### \[([^\]]+)\]\((https:\/\/linux\.do\/t\/[^)]+)\)[\s\S]*?\n([A-Z][a-z]{2}, [^\n]+)/g;
  const items: NormalizedContentInput[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) && items.length < maxItems) {
    const [, title, url, published] = match;
    if (
      keywords.length &&
      !keywords.some((keyword) => title.toLowerCase().includes(keyword))
    ) {
      continue;
    }
    const id = url.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1] || url;
    items.push({
      externalId: id,
      platform: "linuxdo",
      type: "topic",
      title,
      body: "",
      url,
      authorName: "Linux.do 社区",
      publishedAt: normalizeDate(published),
      fetchedAt: new Date().toISOString(),
      metrics: {},
      tags: linuxTags(title, ""),
      raw: { title, url, published, fetchedVia: "jina-reader" },
    });
  }
  return items;
}

function parseRssXml(
  xml: string,
  source: Source,
): NormalizedContentInput[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rss = (parsed.rss ?? parsed.feed ?? {}) as Record<string, unknown>;
  const channel = (rss.channel ?? rss) as Record<string, unknown>;
  const entries = asArray(
    (channel.item ?? channel.entry) as
      | Record<string, unknown>
      | Record<string, unknown>[],
  );
  const { maxItems, filterKeywords } = getSourceCollectionConfig(source);
  const keywords = filterKeywords
    .split(/[,，\n]/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

  return entries
    .map((entry): NormalizedContentInput => {
      const linkValue = entry.link;
      const link =
        typeof linkValue === "object" && linkValue
          ? textValue((linkValue as Record<string, unknown>)["@_href"])
          : textValue(linkValue);
      const title = stripHtml(textValue(entry.title)) || "Linux.do 话题";
      const body = stripHtml(
        textValue(entry.description ?? entry.summary ?? entry.content),
      );
      const authorRaw = entry.author ?? entry["dc:creator"];
      const author =
        typeof authorRaw === "object" && authorRaw
          ? textValue((authorRaw as Record<string, unknown>).name ?? authorRaw)
          : textValue(authorRaw);
      const id =
        textValue(entry.guid ?? entry.id) ||
        link.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1] ||
        link;
      return {
        externalId: id,
        platform: "linuxdo",
        type: "topic",
        title,
        body,
        url: link,
        authorName: author || "Linux.do 社区",
        publishedAt: normalizeDate(
          textValue(entry.pubDate ?? entry.published ?? entry.updated),
        ),
        fetchedAt: new Date().toISOString(),
        metrics: {},
        tags: linuxTags(title, body),
        raw: entry,
      };
    })
    .filter(
      (item) =>
        !keywords.length ||
        keywords.some((keyword) =>
          `${item.title} ${item.body}`.toLowerCase().includes(keyword),
        ),
    )
    .slice(0, maxItems);
}

export async function fetchLinuxDoSource(
  source: Source,
  env: AppEnv,
  providedXml?: string,
): Promise<ConnectorResult> {
  if (!source.target.startsWith("https://linux.do/")) {
    throw new Error("Linux.do 数据源地址不在允许范围内");
  }
  if (providedXml) {
    if (providedXml.length > 5_000_000) {
      throw new Error("Linux.do RSS 内容超过 5 MB 限制");
    }
    if (providedXml.includes("<rss") || providedXml.includes("<feed")) {
      return { items: parseRssXml(providedXml, source), billable: false };
    }
    if (providedXml.includes("https://linux.do/t/")) {
      return { items: parseJinaFallback(providedXml, source), billable: false };
    }
    throw new Error("Linux.do 定时任务返回内容无效");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response = await fetch(source.target, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": browserUserAgent,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      },
      signal: controller.signal,
    });
    const directStatus = response.status;
    let usedFallback = false;
    if (response.status === 403 || response.status === 429) {
      usedFallback = true;
      response = await fetch(`https://r.jina.ai/${source.target}`, {
        headers: {
          Accept: "text/plain",
          "User-Agent": browserUserAgent,
        },
        signal: controller.signal,
      });
      if (response.ok) {
        return {
          items: parseJinaFallback(await response.text(), source),
          billable: false,
        };
      }
    }
    if (!response.ok) {
      const proxyUrl = new URL(
        env.RSS_PROXY_URL ||
          env.LINUXDO_PROXY_URL ||
          "http://127.0.0.1:4317/rss",
      );
      proxyUrl.searchParams.set("url", source.target);
      try {
        const proxyResponse = await fetch(proxyUrl, {
          headers: { Accept: "application/rss+xml" },
          signal: controller.signal,
        });
        if (proxyResponse.ok) response = proxyResponse;
      } catch {
        // The proxy is an optional local/Node-server fallback.
      }
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `Linux.do RSS HTTP ${directStatus}${
          usedFallback ? `，只读回退 HTTP ${response.status}` : ""
        }${
          retryAfter ? `，建议 ${retryAfter} 后重试` : ""
        }`,
      );
    }
    return { items: parseRssXml(await response.text(), source), billable: false };
  } finally {
    clearTimeout(timeout);
  }
}

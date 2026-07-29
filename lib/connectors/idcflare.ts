import { XMLParser } from "fast-xml-parser";
import type { AppEnv } from "@/db/runtime";
import type { ConnectorResult, NormalizedContentInput, Source } from "../types";
import { getSourceCollectionConfig } from "../source-config";
import { normalizeDate, stripHtml } from "./helpers";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

const topicTerms = [
  "AI",
  "大模型",
  "LLM",
  "OpenAI",
  "Claude",
  "GPT",
  "Codex",
  "Agent",
  "VPS",
  "服务器",
  "主机",
  "IP",
  "CDN",
  "域名",
  "线路",
  "U币",
  "USDT",
  "开卡",
  "虚拟卡",
  "支付",
];

function idcFlareTags(
  title: string,
  body: string,
  categories: string[] = [],
): string[] {
  const text = `${title} ${body}`.toLowerCase();
  return Array.from(
    new Set([
      "IDCFlare",
      "每日热门",
      ...categories.filter(Boolean),
      ...topicTerms.filter((term) => text.includes(term.toLowerCase())),
    ]),
  ).slice(0, 9);
}

function filterItems(
  items: NormalizedContentInput[],
  source: Source,
): NormalizedContentInput[] {
  const { maxItems, filterKeywords } = getSourceCollectionConfig(source);
  const keywords = filterKeywords
    .split(/[,，\n]/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  return items
    .filter(
      (item) =>
        !keywords.length ||
        keywords.some((keyword) =>
          `${item.title} ${item.body} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(keyword),
        ),
    )
    .slice(0, maxItems);
}

function parseDiscussionMetrics(body: string): {
  replies?: number;
} {
  const match = body.match(
    /([\d,]+)\s*(?:个)?(?:帖子|posts?)\s*[-–—]\s*([\d,]+)\s*(?:位)?(?:参与者|participants?)/i,
  );
  if (!match) return {};
  const postCount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(postCount)
    ? { replies: Math.max(0, postCount - 1) }
    : {};
}

export function parseIdcFlareRss(
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

  return filterItems(
    entries.map((entry): NormalizedContentInput => {
      const linkValue = entry.link;
      const link =
        typeof linkValue === "object" && linkValue
          ? textValue((linkValue as Record<string, unknown>)["@_href"])
          : textValue(linkValue);
      const title = stripHtml(textValue(entry.title)) || "IDCFlare 话题";
      const rawBody = stripHtml(
        textValue(entry.description ?? entry.summary ?? entry.content),
      );
      const body = rawBody
        .replace(
          /\s*[\d,]+\s*(?:个)?(?:帖子|posts?)\s*[-–—]\s*[\d,]+\s*(?:位)?(?:参与者|participants?)\s*/gi,
          " ",
        )
        .replace(/\s*阅读完整话题\s*$/i, "")
        .trim()
        .slice(0, 4_000);
      const authorRaw = entry.author ?? entry["dc:creator"];
      const author =
        typeof authorRaw === "object" && authorRaw
          ? textValue((authorRaw as Record<string, unknown>).name ?? authorRaw)
          : textValue(authorRaw);
      const categories = asArray(entry.category).map(textValue).filter(Boolean);
      const id =
        textValue(entry.guid ?? entry.id) ||
        link.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1] ||
        link;

      return {
        externalId: id,
        platform: "idcflare",
        type: "topic",
        title,
        body,
        url: link,
        authorName: author || "IDCFlare 社区",
        publishedAt: normalizeDate(
          textValue(entry.pubDate ?? entry.published ?? entry.updated),
        ),
        fetchedAt: new Date().toISOString(),
        metrics: parseDiscussionMetrics(rawBody),
        tags: idcFlareTags(title, body, categories),
        raw: entry,
      };
    }),
    source,
  );
}

function parseJinaFallback(
  markdown: string,
  source: Source,
): NormalizedContentInput[] {
  const items: NormalizedContentInput[] = [];
  const pattern =
    /^### \[(.+?)\]\((https:\/\/idcflare\.com\/t\/[^)]+)\)[\s\S]*?^([A-Z][a-z]{2}, [^\n]+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const [, title, url, published] = match;
    const id = url.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1] || url;
    items.push({
      externalId: id,
      platform: "idcflare",
      type: "topic",
      title: stripHtml(title),
      body: "",
      url,
      authorName: "IDCFlare 社区",
      publishedAt: normalizeDate(published),
      fetchedAt: new Date().toISOString(),
      metrics: {},
      tags: idcFlareTags(title, ""),
      raw: { title, url, published, fetchedVia: "jina-reader" },
    });
  }
  return filterItems(items, source);
}

export function isValidIdcFlareTarget(target: string): boolean {
  try {
    const url = new URL(target);
    return (
      url.protocol === "https:" &&
      url.hostname === "idcflare.com" &&
      url.pathname.endsWith(".rss")
    );
  } catch {
    return false;
  }
}

function validateTarget(target: string): URL {
  if (!isValidIdcFlareTarget(target)) {
    throw new Error("IDCFlare 数据源必须使用 idcflare.com 的 HTTPS RSS 地址");
  }
  return new URL(target);
}

export async function fetchIdcFlareSource(
  source: Source,
  env: AppEnv,
): Promise<ConnectorResult> {
  const target = validateTarget(source.target);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response = await fetch(target, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": browserUserAgent,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      },
      signal: controller.signal,
    });
    const directStatus = response.status;
    if (response.status === 403 || response.status === 429) {
      response = await fetch(`https://r.jina.ai/${target.href}`, {
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
      proxyUrl.searchParams.set("url", target.href);
      try {
        const proxyResponse = await fetch(proxyUrl, {
          headers: { Accept: "application/rss+xml" },
          signal: controller.signal,
        });
        if (proxyResponse.ok) response = proxyResponse;
      } catch {
        // The curl-based proxy is available in local and Node server modes.
      }
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `IDCFlare RSS HTTP ${directStatus}${
          retryAfter ? `，建议 ${retryAfter} 后重试` : ""
        }`,
      );
    }
    const xml = await response.text();
    if (xml.length > 5_000_000) {
      throw new Error("IDCFlare RSS 内容超过 5 MB 限制");
    }
    return {
      items: parseIdcFlareRss(xml, source),
      billable: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

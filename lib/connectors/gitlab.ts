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

const allowedTargets = new Set([
  "https://about.gitlab.com/atom.xml",
  "https://docs.gitlab.com/releases/releases.xml",
  "https://docs.gitlab.com/releases/patch-releases.xml",
  "https://docs.gitlab.com/releases/all-releases.xml",
]);

const topicTerms = [
  "AI",
  "artificial intelligence",
  "Duo",
  "Agent",
  "agentic",
  "LLM",
  "Claude",
  "GPT",
  "Codex",
  "Cursor",
  "MCP",
  "DevSecOps",
  "CI/CD",
  "Runner",
  "security",
  "vulnerability",
  "CVE",
  "supply chain",
  "container",
  "Kubernetes",
];

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

const linkValue = (value: unknown): string => {
  for (const candidate of asArray(value)) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (candidate && typeof candidate === "object") {
      const item = candidate as Record<string, unknown>;
      const href = textValue(item["@_href"] ?? item["#text"]);
      if (href && (!item["@_rel"] || item["@_rel"] === "alternate")) {
        return href;
      }
    }
  }
  return "";
};

const feedLabel = (target: string) =>
  target.includes("patch-releases")
    ? "安全补丁"
    : target.includes("/releases/releases")
      ? "正式版本"
      : target.includes("all-releases")
        ? "全部版本"
        : "官方博客";

function gitLabTags(
  source: Source,
  title: string,
  body: string,
  categories: string[],
): string[] {
  const text = `${title} ${body}`.toLowerCase();
  return Array.from(
    new Set([
      "GitLab",
      feedLabel(source.target),
      ...categories.filter(Boolean),
      ...topicTerms.filter((term) => text.includes(term.toLowerCase())),
    ]),
  ).slice(0, 10);
}

function isLocalizedDuplicate(link: string): boolean {
  try {
    const firstSegment = new URL(link).pathname.split("/").filter(Boolean)[0];
    return Boolean(firstSegment && /^[a-z]{2}-[a-z]{2}$/i.test(firstSegment));
  } catch {
    return false;
  }
}

export function isValidGitLabTarget(target: string): boolean {
  try {
    return allowedTargets.has(new URL(target).href);
  } catch {
    return false;
  }
}

export function parseGitLabFeed(
  xml: string,
  source: Source,
): NormalizedContentInput[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = (parsed.feed ?? parsed.rss ?? {}) as Record<string, unknown>;
  const channel = (root.channel ?? root) as Record<string, unknown>;
  const entries = asArray(
    (channel.entry ?? channel.item) as
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
      const link = linkValue(entry.link);
      const title = stripHtml(textValue(entry.title)) || "GitLab 官方更新";
      const body = stripHtml(
        textValue(
          entry.content ?? entry.description ?? entry.summary ?? entry.subtitle,
        ),
      ).slice(0, 4_000);
      const authorRaw = entry.author ?? entry["dc:creator"];
      const author =
        typeof authorRaw === "object" && authorRaw
          ? textValue((authorRaw as Record<string, unknown>).name ?? authorRaw)
          : textValue(authorRaw);
      const categories = asArray(entry.category)
        .map((category) =>
          typeof category === "object" && category
            ? textValue(
                (category as Record<string, unknown>)["@_term"] ?? category,
              )
            : textValue(category),
        )
        .filter(Boolean);
      return {
        externalId: textValue(entry.id ?? entry.guid) || link,
        platform: "gitlab",
        type: "post",
        title,
        body,
        url: link,
        authorName: author || "GitLab 官方",
        publishedAt: normalizeDate(
          textValue(entry.published ?? entry.pubDate ?? entry.updated),
        ),
        fetchedAt: new Date().toISOString(),
        metrics: {},
        tags: gitLabTags(source, title, body, categories),
        raw: entry,
      };
    })
    .filter((item) => item.url && !isLocalizedDuplicate(item.url))
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

export async function fetchGitLabSource(
  source: Source,
  env: AppEnv,
): Promise<ConnectorResult> {
  if (!isValidGitLabTarget(source.target)) {
    throw new Error("GitLab 数据源必须使用允许的官方 RSS 地址");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response = await fetch(source.target, {
      headers: {
        Accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": browserUserAgent,
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.7",
      },
      signal: controller.signal,
    });
    const directStatus = response.status;
    if (!response.ok) {
      const proxyUrl = new URL(
        env.RSS_PROXY_URL ||
          env.LINUXDO_PROXY_URL ||
          "http://127.0.0.1:4317/rss",
      );
      proxyUrl.searchParams.set("url", source.target);
      try {
        const proxyResponse = await fetch(proxyUrl, {
          headers: { Accept: "application/atom+xml, application/xml" },
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
        `GitLab RSS HTTP ${directStatus}${
          retryAfter ? `，建议 ${retryAfter} 后重试` : ""
        }`,
      );
    }
    const xml = await response.text();
    if (xml.length > 5_000_000) {
      throw new Error("GitLab RSS 内容超过 5 MB 限制");
    }
    return {
      items: parseGitLabFeed(xml, source),
      billable: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

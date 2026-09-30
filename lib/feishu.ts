import type { AppEnv } from "@/db/runtime";
import type { ContentReview } from "@/lib/types";

type FeishuEnvelope<T> = {
  code?: number;
  msg?: string;
  data?: T;
};

type FeishuTextElement = {
  text_run: {
    content: string;
    text_element_style?: {
      bold?: boolean;
      link?: { url: string };
    };
  };
};

type FeishuBlock = Record<string, unknown> & { block_type: number };

export interface FeishuConfigStatus {
  configured: boolean;
  destination: "document" | "wiki" | "folder" | "unconfigured";
  spaceIdHint?: string;
  parentNodeConfigured: boolean;
  tenantDomainConfigured: boolean;
  dailyDocumentConfigured: boolean;
  dailyDocumentIdHint?: string;
  dailyWikiNodeConfigured: boolean;
  dailyWikiNodeTokenHint?: string;
  message: string;
}

export interface FeishuPublishResult {
  documentId: string;
  wikiNodeToken?: string;
  url: string;
  contentHash: string;
}

export function normalizeFeishuDocumentId(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  if (/\/wiki\//i.test(trimmed)) return "";
  const pathMatch = trimmed.match(/\/docx\/([A-Za-z0-9_-]+)/);
  const token = pathMatch?.[1] || trimmed;
  return /^[A-Za-z0-9_-]{8,}$/.test(token) ? token : "";
}

export function normalizeFeishuWikiNodeToken(
  value: string | undefined,
): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  const pathMatch = trimmed.match(/\/wiki\/([A-Za-z0-9_-]+)/i);
  const token = pathMatch?.[1] || trimmed;
  return /^[A-Za-z0-9_-]{8,}$/.test(token) ? token : "";
}

export function getFeishuConfigStatus(env: AppEnv): FeishuConfigStatus {
  const credentialsReady = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
  const dailyDocumentId = normalizeFeishuDocumentId(
    env.FEISHU_DAILY_DOCUMENT_ID,
  );
  const dailyWikiNodeToken = normalizeFeishuWikiNodeToken(
    env.FEISHU_DAILY_WIKI_NODE_TOKEN ||
      (/\/wiki\//i.test(env.FEISHU_DAILY_DOCUMENT_ID || "")
        ? env.FEISHU_DAILY_DOCUMENT_ID
        : undefined),
  );
  const destination = dailyWikiNodeToken
    ? "wiki"
    : dailyDocumentId
    ? "document"
    : env.FEISHU_WIKI_SPACE_ID
      ? "wiki"
      : env.FEISHU_FOLDER_TOKEN
        ? "folder"
        : "unconfigured";
  const dailyTargetConfigured = Boolean(
    dailyDocumentId || dailyWikiNodeToken,
  );
  const configured = credentialsReady && dailyTargetConfigured;
  return {
    configured,
    destination,
    spaceIdHint: env.FEISHU_WIKI_SPACE_ID
      ? `${env.FEISHU_WIKI_SPACE_ID.slice(0, 5)}…${env.FEISHU_WIKI_SPACE_ID.slice(-3)}`
      : undefined,
    parentNodeConfigured: Boolean(env.FEISHU_WIKI_PARENT_NODE_TOKEN),
    tenantDomainConfigured: Boolean(env.FEISHU_TENANT_DOMAIN),
    dailyDocumentConfigured: dailyTargetConfigured,
    dailyDocumentIdHint: dailyDocumentId
      ? `${dailyDocumentId.slice(0, 6)}…${dailyDocumentId.slice(-4)}`
      : undefined,
    dailyWikiNodeConfigured: Boolean(dailyWikiNodeToken),
    dailyWikiNodeTokenHint: dailyWikiNodeToken
      ? `${dailyWikiNodeToken.slice(0, 6)}…${dailyWikiNodeToken.slice(-4)}`
      : undefined,
    message: !credentialsReady
      ? "请先配置飞书自建应用凭据"
      : !dailyTargetConfigured
        ? "请配置专用总文档或Wiki页面"
        : dailyWikiNodeToken
          ? "审核通过的文章将按日期写入同一个飞书Wiki页面"
          : "审核通过的文章将按日期写入同一份飞书云文档",
  };
}

async function getTenantAccessToken(env: AppEnv): Promise<string> {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书应用凭据尚未配置");
  }
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
      }),
    },
  );
  const payload = (await response.json()) as FeishuEnvelope<never> & {
    tenant_access_token?: string;
  };
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(payload.msg || "无法获取飞书访问凭证");
  }
  return payload.tenant_access_token;
}

async function feishuRequest<T>(
  token: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
  const payload = (await response.json()) as FeishuEnvelope<T>;
  if (!response.ok || payload.code !== 0 || payload.data === undefined) {
    throw new Error(payload.msg || `飞书接口请求失败 (${response.status})`);
  }
  return payload.data;
}

type FeishuDocumentTarget = {
  documentId: string;
  wikiNodeToken?: string;
};

async function resolveFeishuDocumentTarget(
  token: string,
  env: AppEnv,
): Promise<FeishuDocumentTarget> {
  const configuredWikiValue =
    env.FEISHU_DAILY_WIKI_NODE_TOKEN ||
    (/\/wiki\//i.test(env.FEISHU_DAILY_DOCUMENT_ID || "")
      ? env.FEISHU_DAILY_DOCUMENT_ID
      : undefined);
  const wikiNodeToken = normalizeFeishuWikiNodeToken(configuredWikiValue);
  if (wikiNodeToken) {
    const data = await feishuRequest<{
      node?: {
        node_token?: string;
        obj_token?: string;
        obj_type?: string;
      };
    }>(
      token,
      `/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiNodeToken)}`,
      { method: "GET" },
    );
    const node = data.node;
    if (!node?.obj_token) {
      throw new Error("飞书Wiki节点没有返回底层文档Token");
    }
    if (node.obj_type !== "docx") {
      throw new Error(
        `飞书Wiki节点类型为${node.obj_type || "未知"}，每日总文档必须是新版Docx文档`,
      );
    }
    return {
      documentId: node.obj_token,
      wikiNodeToken: node.node_token || wikiNodeToken,
    };
  }

  const documentId = normalizeFeishuDocumentId(
    env.FEISHU_DAILY_DOCUMENT_ID,
  );
  if (!documentId) {
    throw new Error("飞书专用总文档或Wiki节点格式无效");
  }
  return { documentId };
}

function textElements(value: string): FeishuTextElement[] {
  const elements: FeishuTextElement[] = [];
  const clean = value.replace(/\*\*/g, "").replace(/__/g, "");
  const linkPattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)/g;
  let cursor = 0;
  for (const match of clean.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      elements.push({
        text_run: { content: clean.slice(cursor, index), text_element_style: {} },
      });
    }
    elements.push({
      text_run: {
        content: match[1],
        text_element_style: { link: { url: match[2] } },
      },
    });
    cursor = index + match[0].length;
  }
  if (cursor < clean.length) {
    elements.push({
      text_run: { content: clean.slice(cursor), text_element_style: {} },
    });
  }
  return elements.length
    ? elements
    : [{ text_run: { content: clean || " ", text_element_style: {} } }];
}

function textBlock(
  type: "text" | "heading1" | "heading2" | "heading3" | "bullet" | "ordered" | "quote",
  content: string,
): FeishuBlock {
  const blockTypes = {
    text: 2,
    heading1: 3,
    heading2: 4,
    heading3: 5,
    bullet: 12,
    ordered: 13,
    quote: 15,
  } as const;
  return {
    block_type: blockTypes[type],
    [type]: {
      elements: textElements(content),
      style: {},
    },
  };
}

function splitLongText(value: string, maxLength = 1_800): string[] {
  if (value.length <= maxLength) return [value];
  const parts: string[] = [];
  let rest = value;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("。", maxLength);
    if (cut < maxLength * 0.55) cut = rest.lastIndexOf(" ", maxLength);
    if (cut < maxLength * 0.55) cut = maxLength;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function markdownToFeishuBlocks(markdown: string): FeishuBlock[] {
  const blocks: FeishuBlock[] = [];
  const paragraph: string[] = [];
  const flushParagraph = () => {
    const value = paragraph.join(" ").trim();
    paragraph.length = 0;
    if (!value) return;
    for (const part of splitLongText(value)) blocks.push(textBlock("text", part));
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^---+$/.test(line)) {
      flushParagraph();
      blocks.push({ block_type: 22, divider: {} });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const type =
        heading[1].length === 1
          ? "heading1"
          : heading[1].length === 2
            ? "heading2"
            : "heading3";
      blocks.push(textBlock(type, heading[2]));
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(textBlock("bullet", bullet[1]));
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push(textBlock("ordered", ordered[1]));
      continue;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      blocks.push(textBlock("quote", quote[1]));
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

async function contentHash(title: string, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}\n${content}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function documentUrl(
  env: AppEnv,
  documentId: string,
  wikiNodeToken?: string,
): string {
  const configuredDomain = env.FEISHU_TENANT_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const domain =
    configuredDomain && /^[a-z0-9.-]+$/i.test(configuredDomain)
      ? configuredDomain
      : "www.feishu.cn";
  return wikiNodeToken
    ? `https://${domain}/wiki/${wikiNodeToken}`
    : `https://${domain}/docx/${documentId}`;
}

async function replaceDocumentBlocks(
  token: string,
  documentId: string,
  blocks: FeishuBlock[],
): Promise<void> {
  for (let round = 0; round < 30; round += 1) {
    const existing = await feishuRequest<{
      items?: Array<{ block_id?: string }>;
    }>(
      token,
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children?page_size=500&document_revision_id=-1`,
      { method: "GET" },
    );
    const count = existing.items?.length ?? 0;
    if (!count) break;
    await feishuRequest<Record<string, never>>(
      token,
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children/batch_delete?document_revision_id=-1`,
      {
        method: "DELETE",
        body: JSON.stringify({ start_index: 0, end_index: count }),
      },
    );
    if (round === 29) {
      throw new Error("飞书总文档内容块过多，未能在安全次数内完成更新");
    }
  }
  for (let index = 0; index < blocks.length; index += 40) {
    await feishuRequest<Record<string, unknown>>(
      token,
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
      {
        method: "POST",
        body: JSON.stringify({ children: blocks.slice(index, index + 40) }),
      },
    );
  }
}

const shanghaiDateParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return {
    key: `${year}-${month}-${day}`,
    label: `${year}年${Number(month)}月${Number(day)}日`,
  };
};

const demoteArticleHeadings = (markdown: string) =>
  markdown.replace(/^#{1,6}\s+/gm, "### ");

export function buildDailyFeishuBlocks(
  reviews: ContentReview[],
  currentContentId: string,
  now = new Date().toISOString(),
): FeishuBlock[] {
  const unique = new Map<string, ContentReview>();
  for (const review of reviews) unique.set(review.contentId, review);
  const grouped = new Map<
    string,
    { label: string; reviews: Array<{ review: ContentReview; publishedAt: string }> }
  >();

  for (const review of unique.values()) {
    if (review.status !== "approved") continue;
    const publishedAt =
      review.publishedAt ||
      (review.contentId === currentContentId ? now : review.reviewedAt || now);
    const date = shanghaiDateParts(publishedAt);
    const group = grouped.get(date.key) || { label: date.label, reviews: [] };
    group.reviews.push({ review, publishedAt });
    grouped.set(date.key, group);
  }

  const blocks: FeishuBlock[] = [
    textBlock(
      "quote",
      `由AI情报雷达同步。按北京时间归档，最后更新：${new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(now))}`,
    ),
  ];
  const dates = [...grouped.entries()].sort(([left], [right]) =>
    right.localeCompare(left),
  );
  for (const [, group] of dates) {
    blocks.push(textBlock("heading1", group.label));
    group.reviews
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .forEach(({ review }) => {
        blocks.push(textBlock("heading2", review.editorTitle.trim()));
        blocks.push(
          textBlock(
            "quote",
            [
              `来源：${review.source.sourceName || review.source.platform}`,
              review.source.authorName ? `作者：${review.source.authorName}` : "",
              review.reviewerName ? `审核：${review.reviewerName}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        blocks.push(
          ...markdownToFeishuBlocks(
            demoteArticleHeadings(review.editorContent.trim()),
          ),
        );
        blocks.push(
          textBlock("text", `[查看原始来源](${review.source.url})`),
          { block_type: 22, divider: {} },
        );
      });
  }
  return blocks;
}

async function updateDocumentTitle(
  token: string,
  documentId: string,
  title: string,
): Promise<void> {
  await feishuRequest<Record<string, unknown>>(
    token,
    `/docx/v1/documents/${documentId}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
}

export async function publishReviewToFeishu(
  review: ContentReview,
  env: AppEnv,
  publishedReviews: ContentReview[] = [],
): Promise<FeishuPublishResult> {
  const config = getFeishuConfigStatus(env);
  if (!config.configured) throw new Error(config.message);
  if (review.status !== "approved") {
    throw new Error("内容必须先审核通过才能发布");
  }
  const title = review.editorTitle.trim();
  const content = review.editorContent.trim();
  if (!title || !content) throw new Error("发布标题和正文不能为空");
  const hash = await contentHash(title, content);
  const token = await getTenantAccessToken(env);
  const { documentId, wikiNodeToken } = await resolveFeishuDocumentTarget(
    token,
    env,
  );
  if (!wikiNodeToken) {
    const documentTitle =
      env.FEISHU_DAILY_DOCUMENT_TITLE?.trim() || "AI 情报雷达 · 每日精选";
    await updateDocumentTitle(token, documentId, documentTitle);
  }
  const blocks = buildDailyFeishuBlocks(
    [review, ...publishedReviews],
    review.contentId,
  );
  if (!blocks.length) throw new Error("发布正文没有可写入的内容块");
  await replaceDocumentBlocks(token, documentId, blocks);
  return {
    documentId,
    wikiNodeToken,
    url: documentUrl(env, documentId, wikiNodeToken),
    contentHash: hash,
  };
}

// Shared, dependency-free rules used by the editor, server and tests.
export const WECHAT_WRITING_VERSION = "2026-09-17.v1";
export const WECHAT_ASSET_PREFIX = "/api/wechat/assets/";
export interface WechatArticle {
  title: string;
  digest: string;
  author: string;
  bodyMarkdown: string;
  coverUrl: string;
}
export interface WechatDraft extends WechatArticle {
  contentId: string;
  version: number;
  operation: "" | "generating" | "syncing";
  operationStartedAt: string | null;
  status: "draft" | "synced" | "failed" | "unknown";
  message: string;
  sourceHash: string;
  profileVersion: string;
  mediaId: string;
  accountId: string;
  syncedHash: string;
  syncedAt: string | null;
  updatedAt: string;
  imageCache: Record<string, string>;
  coverMediaId: string;
  uploadedCoverUrl: string;
}
export interface WechatSyncLog {
  id: string;
  status: string;
  message: string;
  mediaId: string;
  createdAt: string;
}
export interface WechatConfigStatus {
  configured: boolean;
  aiConfigured: boolean;
  message: string;
}

export const articleFields = (article: WechatArticle): WechatArticle => ({
  title: article.title.trim(), digest: article.digest.trim(),
  author: article.author.trim(), bodyMarkdown: article.bodyMarkdown.trim(),
  coverUrl: article.coverUrl.trim(),
});

export function isImageLocation(value: string): boolean {
  if (/^\/api\/wechat\/assets\/[a-f0-9-]{36}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

// Restrict to stand-alone Markdown images, so no HTML/hidden image gets lost
// between preview and publication. URLs may be wrapped in <> to include spaces.
export function imageFromLine(line: string): { alt: string; url: string } | null {
  const match = line.trim().match(/^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)$/);
  if (!match) return null;
  return { alt: match[1], url: match[2] || match[3] };
}
export function articleImages(markdown: string): Array<{ alt: string; url: string }> {
  let code = false;
  return markdown.split(/\r?\n/).flatMap((line) => {
    if (/^\s*```/.test(line)) { code = !code; return []; }
    const image = code ? null : imageFromLine(line);
    return image ? [image] : [];
  });
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

function inline(value: string): string {
  // Raw HTML is always text; no user-supplied tags or event handlers survive.
  const escaped = escapeHtml(value);
  return escaped.replace(/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_all, code: string, bold: string, label: string) =>
      code ? `<code>${code}</code>` : bold ? `<strong>${bold}</strong>` : label);
}

export function renderWechatHtml(markdown: string, images: Record<string, string> = {}): string {
  const result: string[] = [];
  let code: string[] | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) result.push(`<p style="margin:0 0 18px">${inline(paragraph.join("\n")).replace(/\n/g, "<br/>")}</p>`);
    paragraph = [];
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      flush();
      if (code) { result.push(`<pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f5;padding:12px">${escapeHtml(code.join("\n"))}</pre>`); code = null; }
      else code = [];
      continue;
    }
    if (code) { code.push(raw); continue; }
    if (!line) { flush(); continue; }
    const image = imageFromLine(line);
    if (image) {
      flush();
      const url = images[image.url] || image.url;
      if (isImageLocation(url)) result.push(`<p style="margin:20px 0"><img src="${escapeHtml(url)}" alt="${escapeHtml(image.alt)}" style="display:block;width:100%;height:auto"/>${image.alt ? `<span style="display:block;color:#666;font-size:13px;margin-top:8px">${escapeHtml(image.alt)}</span>` : ""}</p>`);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { flush(); result.push(`<h2 style="font-size:20px;line-height:1.5;margin:28px 0 14px">${inline(heading[1])}</h2>`); continue; }
    if (/^([-*_])\1{2,}$/.test(line)) { flush(); result.push('<hr style="border:0;border-top:1px solid #ddd;margin:28px 0"/>'); continue; }
    if (line.startsWith("> ")) { flush(); result.push(`<blockquote style="border-left:3px solid #288568;padding:8px 14px;margin:20px 0;color:#555">${inline(line.slice(2))}</blockquote>`); continue; }
    if (/^[-*]\s+/.test(line)) { flush(); result.push(`<p style="margin:0 0 12px;padding-left:12px">• ${inline(line.replace(/^[-*]\s+/, ""))}</p>`); continue; }
    paragraph.push(line);
  }
  flush();
  if (code) result.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
  return `<section style="font-size:16px;line-height:1.85;color:#242424;overflow-wrap:anywhere">${result.join("\n")}</section>`;
}

export function validateWechatArticle(article: WechatArticle, forSync = false): string[] {
  const errors: string[] = [];
  if (!article.title.trim() || Array.from(article.title).length > 32) errors.push("标题需为 1—32 字");
  if (Array.from(article.digest).length > 120) errors.push("摘要不能超过 120 字");
  if (Array.from(article.author).length > 16) errors.push("作者不能超过 16 字");
  if (!article.bodyMarkdown.trim()) errors.push("正文不能为空");
  if (article.bodyMarkdown.length > 60_000) errors.push("正文超过本地编辑上限，请拆分文章");
  if (article.coverUrl && !isImageLocation(article.coverUrl)) errors.push("封面需为已上传的图片或 HTTPS 图片地址");
  if (forSync && !article.coverUrl) errors.push("请先选择或上传封面");
  let code = false;
  for (const line of article.bodyMarkdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { code = !code; continue; }
    if (code) continue;
    if (/!\[/.test(line) && !imageFromLine(line)) errors.push("每张图片需单独占一行，使用 ![说明](图片地址)");
    if (/<\/?(?:img|iframe|video|script)\b/i.test(line)) errors.push("不支持 HTML 图片、脚本或视频嵌入，请使用 Markdown 图片");
  }
  const images = articleImages(article.bodyMarkdown);
  if (images.some((image) => !isImageLocation(image.url))) errors.push("正文包含无效图片地址，请上传图片后替换");
  if (images.length > 20) errors.push("单篇最多 20 张正文图片");
  if (forSync && !images.length) errors.push("正文至少加入一张与内容相关的真实图片");
  if (forSync && renderWechatHtml(article.bodyMarkdown).length >= 20_000) errors.push("排版后的正文超过微信 2 万字符限制，请拆篇或精简后再同步");
  return [...new Set(errors)];
}

export async function contentHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function blankWechatDraft(contentId: string): WechatDraft {
  return {
    contentId, version: 0, operation: "", operationStartedAt: null,
    title: "", digest: "", author: "", bodyMarkdown: "", coverUrl: "",
    status: "draft", message: "尚未生成公众号稿件", sourceHash: "", profileVersion: WECHAT_WRITING_VERSION,
    mediaId: "", accountId: "", syncedHash: "", syncedAt: null, updatedAt: new Date().toISOString(),
    imageCache: {}, coverMediaId: "", uploadedCoverUrl: "",
  };
}

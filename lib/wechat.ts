import type { AppEnv } from "@/db/runtime";
import { getWechatAsset, WechatError } from "@/db/wechat";
import { WECHAT_ASSET_PREFIX, type WechatConfigStatus } from "./wechat-content";

export function getWechatConfigStatus(env: AppEnv): WechatConfigStatus {
  const configured = Boolean(env.WECHAT_APP_ID?.trim() && env.WECHAT_APP_SECRET?.trim());
  return {
    configured, aiConfigured: Boolean(env.AI_API_KEY?.trim()),
    message: configured
      ? "凭据已设置；接口权限和 IP 白名单将在同步时校验。仅保存草稿，不自动发布。"
      : "请在项目 .env.local 配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET，并重启服务。",
  };
}

export class WechatApiError extends WechatError {}
const codeMessages: Record<number, string> = {
  40001: "接口凭据无效，请检查公众号 AppID / AppSecret",
  40013: "公众号 AppID 无效", 40125: "公众号 AppSecret 无效",
  40164: "服务器出口 IP 不在公众号 IP 白名单，请在公众号后台添加",
  48001: "该公众号没有此接口权限，请检查账号类型、认证状态和接口权限",
  40007: "草稿或封面素材已失效（可能已发布或删除），请检查公众号后台",
  40005: "图片格式不受支持，请使用 JPG 或 PNG",
  40009: "图片大小或尺寸不符合微信要求", 45009: "微信接口调用额度已用完，请稍后重试",
  45007: "正文过长，请拆分文章后再同步", 45166: "正文格式不符合微信要求，请检查排版",
};

export async function wechatRequest(
  path: string, body: object | FormData, token?: string, query?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.weixin.qq.com/cgi-bin/${path}`);
  if (token) url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch { throw new WechatError("微信接口连接中断或超时", 502); }
  if (!response.ok) throw new WechatError(`微信接口暂不可用（HTTP ${response.status}）`, 502);
  let result: Record<string, unknown>;
  try {
    result = await response.json() as Record<string, unknown>;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
  }
  catch { throw new WechatError("微信返回内容无法解析", 502); }
  if (Number(result.errcode)) {
    const code = Number(result.errcode);
    // Do not echo errmsg: WeChat can put credentials or request URLs in it.
    throw new WechatApiError(`微信错误 ${code}：${codeMessages[code] || "请求被拒绝，请检查公众号权限、素材和正文"}`, 502);
  }
  return result;
}

export async function getWechatToken(env: AppEnv): Promise<string> {
  if (!getWechatConfigStatus(env).configured) throw new WechatError("公众号接口尚未配置", 503);
  const result = await wechatRequest("stable_token", {
    grant_type: "client_credential", appid: env.WECHAT_APP_ID!.trim(),
    secret: env.WECHAT_APP_SECRET!.trim(), force_refresh: false,
  });
  if (typeof result.access_token !== "string") throw new WechatError("微信未返回有效接口凭据", 502);
  return result.access_token;
}

const defaultImageHosts = [
  "pbs.twimg.com", "i.ytimg.com", "img.youtube.com", "raw.githubusercontent.com",
  "user-images.githubusercontent.com", "github.com", "private-user-images.githubusercontent.com",
  "linux.do", "cdn.linux.do", "upload.linux.do", "mmbiz.qpic.cn", "mmbiz.qlogo.cn",
];

export function allowedImageUrl(value: string, env: AppEnv): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new WechatError("图片地址无效，请重新上传"); }
  const extra = (env.WECHAT_IMAGE_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  // Exact, server-controlled hostname allowlist; no IPs, wildcards, userinfo,
  // custom ports, cookies or Authorization headers. Every redirect is checked.
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      ![...defaultImageHosts, ...extra].includes(url.hostname) ||
      /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|[\d.]+|\[.*\])$/.test(url.hostname)) {
    throw new WechatError("图片域名未获允许。请下载后用本地上传替换，或由管理员配置 WECHAT_IMAGE_HOSTS");
  }
  return url;
}

export function inspectWechatImage(bytes: Uint8Array): { mime: string; width: number; height: number } {
  if (!bytes.length || bytes.length >= 1_000_000) throw new WechatError("图片需小于 1 MB；请压缩为清晰的 JPG / PNG 后上传");
  if (bytes.length >= 24 && bytes.slice(0, 8).every((byte, i) => byte === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width && height && width <= 20_000 && height <= 20_000) return { mime: "image/png", width, height };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
        if (width && height) return { mime: "image/jpeg", width, height };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  throw new WechatError("图片文件无效或格式不支持，请使用真实 JPG / PNG 图片");
}

export async function readWechatImage(location: string, env: AppEnv) {
  let bytes: Uint8Array;
  if (/^\/api\/wechat\/assets\/[a-f0-9-]{36}$/.test(location)) {
    const stored = await getWechatAsset(location.slice(WECHAT_ASSET_PREFIX.length));
    if (!stored) throw new WechatError("本地图片不存在，请重新上传");
    bytes = Uint8Array.from(atob(stored.data), (char) => char.charCodeAt(0));
  } else {
    let url = allowedImageUrl(location, env);
    let response: Response | undefined;
    for (let redirects = 0; redirects < 4; redirects++) {
      try { response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) }); }
      catch { throw new WechatError("正文或封面图片下载失败，请改用本地上传", 502); }
      if (response.status >= 300 && response.status < 400) {
        const target = response.headers.get("location");
        await response.body?.cancel();
        if (!target) throw new WechatError("图片重定向无效");
        url = allowedImageUrl(new URL(target, url).toString(), env);
      } else break;
    }
    if (!response?.ok || !response.body) throw new WechatError("图片不可访问，请改用本地上传", 422);
    if (Number(response.headers.get("content-length") || 0) >= 1_000_000) {
      await response.body.cancel();
      throw new WechatError("图片超过 1 MB，请压缩后本地上传");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size >= 1_000_000) throw new WechatError("图片超过 1 MB，请压缩后本地上传");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  }
  const info = inspectWechatImage(bytes);
  return { ...info, bytes };
}

export async function uploadWechatImage(image: Awaited<ReturnType<typeof readWechatImage>>, token: string, cover = false) {
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), image.mime === "image/png" ? "article.png" : "article.jpg");
  const result = await wechatRequest(cover ? "material/add_material" : "media/uploadimg", form, token, cover ? { type: "image" } : undefined);
  if (cover) {
    if (typeof result.media_id !== "string") throw new WechatError("封面上传未返回素材 ID", 502);
    return result.media_id;
  }
  if (typeof result.url !== "string") throw new WechatError("图片上传未返回地址", 502);
  const url = new URL(result.url);
  if (!/^(?:https?:)$/.test(url.protocol) || !["mmbiz.qpic.cn", "mmbiz.qlogo.cn"].includes(url.hostname)) throw new WechatError("微信返回的图片地址无效", 502);
  url.protocol = "https:";
  return url.toString();
}

export function coverCrop(width: number, height: number) {
  return { crop_percent_list: [2.35, 1].map((ratio) => {
    const w = Math.min(1, height * ratio / width), h = Math.min(1, width / ratio / height);
    return { ratio: ratio === 1 ? "1_1" : "2.35_1", x1: ((1 - w) / 2).toFixed(4), y1: ((1 - h) / 2).toFixed(4), x2: ((1 + w) / 2).toFixed(4), y2: ((1 + h) / 2).toFixed(4) };
  }) };
}

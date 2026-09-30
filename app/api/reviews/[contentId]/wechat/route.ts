import { getAppEnv } from "@/db/runtime";
import { getWechatDraft, listWechatLogs, WechatError } from "@/db/wechat";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { getWechatConfigStatus } from "@/lib/wechat";
import { editWechatVersion, generateWechatVersion, reconcileWechatVersion, syncWechatVersion } from "@/lib/wechat-workflow";
import type { WechatArticle } from "@/lib/wechat-content";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ contentId: string }> };
const failure = (error: unknown) => privateJson({ error: error instanceof WechatError ? error.message : "公众号操作失败，请刷新后重试" }, { status: error instanceof WechatError ? error.statusCode : 500 });

export async function GET(_request: Request, context: Context) {
  try {
    const { contentId } = await context.params;
    const [draft, logs, env] = await Promise.all([getWechatDraft(contentId), listWechatLogs(contentId), getAppEnv()]);
    return privateJson({ draft, logs, config: getWechatConfigStatus(env) });
  } catch (error) { return failure(error); }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 150_000) throw new WechatError("请求内容过大", 413);
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data) || !Number.isSafeInteger(data.version) || data.version < 0) throw new Error();
    return data;
  } catch { throw new WechatError("请求参数无效，请刷新页面"); }
}

export async function POST(request: Request, context: Context) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  try {
    const { contentId } = await context.params;
    const payload = await body(request);
    const version = payload.version as number;
    const env = await getAppEnv();
    let draft;
    if (payload.action === "generate") draft = await generateWechatVersion(contentId, version, env);
    else if (payload.action === "sync") {
      if (payload.reviewConfirmed !== true) throw new WechatError("请先检查公众号稿件及图片使用权，并确认只发送草稿箱");
      draft = await syncWechatVersion(contentId, version, env);
    } else if (payload.action === "reconcile") {
      draft = await reconcileWechatVersion(contentId, version, typeof payload.mediaId === "string" ? payload.mediaId.trim() : "", payload.confirmNoRemoteDraft === true, env);
    } else throw new WechatError("不支持的公众号操作");
    return privateJson({ draft, logs: await listWechatLogs(contentId) });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: Context) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  try {
    const { contentId } = await context.params;
    const payload = await body(request);
    const fields = ["title", "digest", "author", "bodyMarkdown", "coverUrl"] as const;
    if (fields.some((field) => typeof payload[field] !== "string")) throw new WechatError("稿件字段不完整");
    const article = Object.fromEntries(fields.map((field) => [field, payload[field]])) as unknown as WechatArticle;
    return privateJson({ draft: await editWechatVersion(contentId, payload.version as number, article) });
  } catch (error) { return failure(error); }
}

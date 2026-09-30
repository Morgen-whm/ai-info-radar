import { searchStoredContents } from "@/db/search";
import { listReviewInboxLinks, listRewriteJobsForContents } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { searchLiveTopics } from "@/lib/live-search";
import { parseSearchOptions } from "@/lib/topic-search";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { readTikHubCredential } from "@/lib/tikhub-credentials";
import type { ContentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function editorialState(items: ContentItem[]) {
  if (!items.length) return { reviewInboxIds: [], rewriteJobs: [] };
  const ids = new Set(items.map((item) => item.id));
  const [links, rewriteJobs] = await Promise.all([
    listReviewInboxLinks(), listRewriteJobsForContents([...ids]),
  ]);
  return { reviewInboxIds: links.filter((link) => ids.has(link.contentId)).map((link) => link.contentId), rewriteJobs };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let options;
  try {
    options = parseSearchOptions({ query: params.get("q"), platforms: params.getAll("platform"),
      sort: params.get("sort") ?? "relevance", range: params.get("range") ?? "all", page: params.get("page") ?? 1 });
  } catch (error) {
    return privateJson({ error: (error as Error).message }, { status: 400 });
  }
  try {
    const result = await searchStoredContents(options);
    return privateJson({ ...result, ...await editorialState(result.items) });
  } catch {
    return privateJson({ error: "数据库搜索暂不可用，请检查本地服务后重试" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let options;
  try {
    const text = await request.text();
    if (text.length > 4_096) throw new Error("搜索参数过长");
    options = parseSearchOptions(JSON.parse(text), true);
  } catch (error) {
    return privateJson({ error: error instanceof SyntaxError ? "搜索参数格式不正确" : (error as Error).message }, { status: 400 });
  }
  try {
    const env = await getAppEnv();
    const credential = await readTikHubCredential(request.headers.get("cookie"), env);
    // Match manual collection: a personal key works locally; server fallback is live-mode only.
    const token = credential?.apiKey || (env.DATA_MODE === "live" ? env.TIKHUB_TOKEN : undefined);
    const result = await searchLiveTopics(options, { ...env, TIKHUB_TOKEN: token });
    return privateJson({ ...result, total: result.items.length, page: 1,
      pageSize: result.items.length, hasMore: false, ...await editorialState(result.items) });
  } catch {
    return privateJson({ error: "搜索服务暂不可用；已保存的结果可在信息流查看，请勿连续重复提交" }, { status: 503 });
  }
}

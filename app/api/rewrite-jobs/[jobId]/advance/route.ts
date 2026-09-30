import { getContentReview, getRewriteJob } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { advanceRewriteJob, failRewriteJob } from "@/lib/rewrite-jobs";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { readTikHubCredential } from "@/lib/tikhub-credentials";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const { jobId } = await context.params;

  try {
    const [job, env] = await Promise.all([getRewriteJob(jobId), getAppEnv()]);
    if (!job) {
      return privateJson({ error: "改写任务不存在" }, { status: 404 });
    }
    const personalCredential = await readTikHubCredential(
      request.headers.get("cookie"),
      env,
    );
    const next = await advanceRewriteJob(
      jobId,
      personalCredential?.apiKey
        ? { ...env, TIKHUB_TOKEN: personalCredential.apiKey }
        : env,
    );
    const review =
      next.status === "completed"
        ? await getContentReview(next.contentId)
        : undefined;
    return privateJson({ job: next, review });
  } catch (error) {
    console.error("Failed to advance rewrite job", error);
    const failed = await failRewriteJob(jobId, error).catch(() => null);
    return privateJson(
      {
        job: failed,
        error: error instanceof Error ? error.message : "改写任务执行失败",
      },
      { status: 500 },
    );
  }
}

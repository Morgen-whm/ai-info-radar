import { getRewriteJob } from "@/db/repository";
import { privateJson } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getRewriteJob(jobId);
  return job
    ? privateJson({ job })
    : privateJson({ error: "改写任务不存在" }, { status: 404 });
}

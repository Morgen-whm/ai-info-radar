import { listJobs } from "@/db/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await listJobs(50);
    return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "暂时无法读取采集任务，正在等待重试" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

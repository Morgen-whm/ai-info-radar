import { getLatestWeeklyReport } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { requireWeeklyApiKey, weeklyJson } from "@/lib/weekly-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = await getAppEnv();
  const unauthorized = await requireWeeklyApiKey(request, env);
  if (unauthorized) return unauthorized;
  const report = await getLatestWeeklyReport();
  return report
    ? weeklyJson({ report })
    : weeklyJson({ error: "暂无已完成周报" }, { status: 404 });
}

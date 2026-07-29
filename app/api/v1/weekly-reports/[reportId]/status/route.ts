import { getWeeklyReportStatus } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import {
  isValidReportId,
  requireWeeklyApiKey,
  weeklyJson,
} from "@/lib/weekly-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ reportId: string }> },
) {
  const env = await getAppEnv();
  const unauthorized = await requireWeeklyApiKey(request, env);
  if (unauthorized) return unauthorized;
  const { reportId } = await context.params;
  if (!isValidReportId(reportId)) {
    return weeklyJson({ error: "周报编号无效" }, { status: 400 });
  }
  const status = await getWeeklyReportStatus(reportId);
  return status
    ? weeklyJson({ report: status })
    : weeklyJson({ error: "周报不存在" }, { status: 404 });
}

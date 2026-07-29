import { getAppEnv } from "@/db/runtime";
import { generateWeeklyReport } from "@/lib/weekly-report";
import { requireWeeklyApiKey, weeklyJson } from "@/lib/weekly-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = await getAppEnv();
  const unauthorized = await requireWeeklyApiKey(request, env);
  if (unauthorized) return unauthorized;

  let payload: Record<string, unknown> = {};
  try {
    const body = await request.text();
    if (body.trim()) payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return weeklyJson({ error: "请求 JSON 无效" }, { status: 400 });
  }

  if (
    payload.weekStart !== undefined &&
    typeof payload.weekStart !== "string"
  ) {
    return weeklyJson(
      { error: "weekStart 必须是日期字符串" },
      { status: 400 },
    );
  }
  if (payload.force !== undefined && typeof payload.force !== "boolean") {
    return weeklyJson({ error: "force 必须是布尔值" }, { status: 400 });
  }

  try {
    const result = await generateWeeklyReport({
      weekStart:
        typeof payload.weekStart === "string"
          ? payload.weekStart.trim()
          : undefined,
      force: payload.force === true,
    });
    return weeklyJson(
      {
        report: result.report,
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("weekStart 必须")
    ) {
      return weeklyJson({ error: error.message }, { status: 400 });
    }
    console.error("Failed to generate weekly report", error);
    return weeklyJson({ error: "周报生成失败" }, { status: 500 });
  }
}

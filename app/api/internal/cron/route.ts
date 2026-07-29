import { getAppEnv } from "@/db/runtime";
import { syncAllDueSources } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = await getAppEnv();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (env.CRON_SECRET && provided !== env.CRON_SECRET) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }
  if (env.DATA_MODE !== "live") {
    return Response.json({
      mode: "demo",
      skipped: true,
      message: "DATA_MODE=live 后才会执行真实定时采集",
    });
  }
  const results = await syncAllDueSources(env);
  return Response.json({ mode: "live", results });
}

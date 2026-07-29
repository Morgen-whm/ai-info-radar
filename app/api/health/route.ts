import { getAppEnv } from "@/db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = await getAppEnv();
  return Response.json({
    status: "ok",
    service: "trendhub",
    time: new Date().toISOString(),
    mode: env.DATA_MODE || "demo",
    connectors: {
      x: Boolean(env.TIKHUB_TOKEN),
      youtube: Boolean(env.TIKHUB_TOKEN),
      linuxdo: true,
      idcflare: true,
      gitlab: true,
      aiSummary: Boolean(env.AI_API_KEY),
    },
    database: Boolean(env.DB),
  });
}

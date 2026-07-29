import { getSource } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { syncSourceById } from "@/lib/sync";
import { readTikHubCredential } from "@/lib/tikhub-credentials";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    sourceId?: string;
    feedContent?: string;
    linuxRssXml?: string;
  };
  if (!payload.sourceId) {
    return Response.json({ error: "缺少 sourceId" }, { status: 400 });
  }

  const env = await getAppEnv();
  try {
    const source = await getSource(payload.sourceId);
    if (!source) {
      return Response.json({ error: "数据源不存在" }, { status: 404 });
    }
    const personalCredential = await readTikHubCredential(
      request.headers.get("cookie"),
      env,
    );
    const canUsePersonalKey =
      Boolean(personalCredential) &&
      (source.platform === "x" || source.platform === "youtube");
    const canUseServerKey =
      env.DATA_MODE === "live" &&
      Boolean(env.TIKHUB_TOKEN) &&
      (source.platform === "x" || source.platform === "youtube");
    const isPublicSource =
      source.platform === "linuxdo" ||
      source.platform === "idcflare" ||
      source.platform === "gitlab";
    if (!isPublicSource && !canUsePersonalKey && !canUseServerKey) {
      return Response.json(
        { error: "请先在设置中配置个人 TikHub API Key，再执行真实采集" },
        { status: 409 },
      );
    }

    const result = await syncSourceById(
      payload.sourceId,
      canUsePersonalKey
        ? { ...env, TIKHUB_TOKEN: personalCredential!.apiKey }
        : env,
      {
        feedContent:
          (source.platform === "linuxdo" ||
            source.platform === "idcflare") &&
          typeof payload.feedContent === "string"
            ? payload.feedContent
            : undefined,
        linuxRssXml:
          source.platform === "linuxdo" &&
          typeof payload.linuxRssXml === "string"
            ? payload.linuxRssXml
            : undefined,
      },
    );
    return Response.json({
      ...result,
      credentialMode: canUsePersonalKey
        ? "personal"
        : canUseServerKey
          ? "server"
          : "public",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "同步失败" },
      { status: 502 },
    );
  }
}

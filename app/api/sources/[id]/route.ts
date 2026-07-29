import { deleteSource, getSource, updateSource } from "@/db/repository";
import { isValidGitLabTarget } from "@/lib/connectors/gitlab";
import { isValidIdcFlareTarget } from "@/lib/connectors/idcflare";
import { sanitizeSourceConfig } from "@/lib/source-config";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const existing = await getSource(id);
  if (!existing) {
    return Response.json({ error: "数据源不存在" }, { status: 404 });
  }
  const target =
    typeof payload.target === "string" ? payload.target.trim() : undefined;
  const intervalMinutes =
    typeof payload.intervalMinutes === "number"
      ? payload.intervalMinutes
      : undefined;
  if (target !== undefined && !target) {
    return Response.json({ error: "采集目标不能为空" }, { status: 400 });
  }
  if (
    target !== undefined &&
    existing.platform === "linuxdo" &&
    !target.startsWith("https://linux.do/")
  ) {
    return Response.json(
      { error: "Linux.do 数据源必须使用 linux.do 的 HTTPS 地址" },
      { status: 400 },
    );
  }
  if (
    target !== undefined &&
    existing.platform === "gitlab" &&
    !isValidGitLabTarget(target)
  ) {
    return Response.json(
      { error: "GitLab 数据源必须使用允许的官方 RSS 地址" },
      { status: 400 },
    );
  }
  if (
    target !== undefined &&
    existing.platform === "idcflare" &&
    !isValidIdcFlareTarget(target)
  ) {
    return Response.json(
      { error: "IDCFlare 数据源必须使用 idcflare.com 的 HTTPS RSS 地址" },
      { status: 400 },
    );
  }
  if (
    intervalMinutes !== undefined &&
    (!Number.isFinite(intervalMinutes) || intervalMinutes < 5)
  ) {
    return Response.json({ error: "采集间隔不能少于 5 分钟" }, { status: 400 });
  }
  const source = await updateSource(id, {
    name: typeof payload.name === "string" ? payload.name.trim() : undefined,
    target,
    enabled:
      typeof payload.enabled === "boolean" ? payload.enabled : undefined,
    intervalMinutes,
    config:
      payload.config === undefined
        ? undefined
        : sanitizeSourceConfig(
            payload.config,
            existing.platform,
            existing.kind,
          ),
  });
  return Response.json({ source });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deleted = await deleteSource(id);
  return deleted
    ? Response.json({ ok: true })
    : Response.json({ error: "数据源不存在" }, { status: 404 });
}

import { createSource, listSources } from "@/db/repository";
import { isValidGitLabTarget } from "@/lib/connectors/gitlab";
import { isValidGitHubTarget } from "@/lib/connectors/github";
import { isValidIdcFlareTarget } from "@/lib/connectors/idcflare";
import { sanitizeSourceConfig } from "@/lib/source-config";
import type { Platform, SourceKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const allowedPlatforms: Platform[] = [
  "x",
  "youtube",
  "linuxdo",
  "idcflare",
  "gitlab",
  "github",
];
const allowedKinds: SourceKind[] = [
  "trending",
  "keyword",
  "account",
  "channel",
  "feed",
];

export async function GET() {
  try {
    return Response.json({ sources: await listSources() });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法读取数据源",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const platform = String(payload.platform ?? "") as Platform;
  const kind = String(payload.kind ?? "") as SourceKind;
  const name = String(payload.name ?? "").trim();
  const target = String(payload.target ?? "").trim();
  const intervalMinutes = Number(payload.intervalMinutes ?? 15);

  if (
    !name ||
    !target ||
    !allowedPlatforms.includes(platform) ||
    !allowedKinds.includes(kind) ||
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes < 5
  ) {
    return Response.json({ error: "数据源参数不完整或不合法" }, { status: 400 });
  }
  if (
    platform === "linuxdo" &&
    !target.startsWith("https://linux.do/")
  ) {
    return Response.json(
      { error: "Linux.do 数据源必须使用 linux.do 的 HTTPS 地址" },
      { status: 400 },
    );
  }
  if (platform === "idcflare" && !isValidIdcFlareTarget(target)) {
    return Response.json(
      { error: "IDCFlare 数据源必须使用 idcflare.com 的 HTTPS RSS 地址" },
      { status: 400 },
    );
  }
  if (platform === "gitlab" && !isValidGitLabTarget(target)) {
    return Response.json(
      { error: "GitLab 数据源必须使用允许的官方 RSS 地址" },
      { status: 400 },
    );
  }
  if (platform === "github" && !isValidGitHubTarget(target)) {
    return Response.json(
      { error: "GitHub 增长榜目标必须为 github://ai-star-growth" },
      { status: 400 },
    );
  }

  const source = await createSource({
    name,
    platform,
    kind,
    target,
    intervalMinutes,
    config: sanitizeSourceConfig(payload.config, platform, kind),
  });
  return Response.json({ source }, { status: 201 });
}

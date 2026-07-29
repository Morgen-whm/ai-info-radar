import { getAppEnv } from "@/db/runtime";
import {
  clearTikHubCredentialCookie,
  createTikHubCredentialCookie,
  encryptTikHubCredential,
  hasTikHubCredentialEncryption,
  readTikHubCredential,
  tikHubKeyHint,
} from "@/lib/tikhub-credentials";
import {
  normalizeTikHubApiKey,
  TikHubApiError,
  validateTikHubApiKey,
} from "@/lib/tikhub-client";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  const env = await getAppEnv();
  const storageReady = hasTikHubCredentialEncryption(env);
  const credential = storageReady
    ? await readTikHubCredential(request.headers.get("cookie"), env)
    : null;

  return Response.json(
    {
      storageReady,
      configured: Boolean(credential),
      keyHint: credential ? tikHubKeyHint(credential.apiKey) : undefined,
      savedAt: credential?.savedAt,
      profile: credential?.profile,
      serverFallbackConfigured: Boolean(env.TIKHUB_TOKEN),
      message: storageReady
        ? undefined
        : "管理员需先配置 TIKHUB_KEY_ENCRYPTION_SECRET（至少 24 个字符）",
    },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }

  const env = await getAppEnv();
  if (!hasTikHubCredentialEncryption(env)) {
    return Response.json(
      {
        error:
          "服务端尚未配置 TIKHUB_KEY_ENCRYPTION_SECRET（至少 24 个字符）",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let body: { apiKey?: unknown };
  try {
    body = (await request.json()) as { apiKey?: unknown };
  } catch {
    return Response.json(
      { error: "请求内容不是有效的 JSON" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const apiKey =
    typeof body.apiKey === "string" ? normalizeTikHubApiKey(body.apiKey) : "";
  if (apiKey.length < 8 || apiKey.length > 512) {
    return Response.json(
      { error: "请输入有效的 TikHub API Key" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const profile = await validateTikHubApiKey(env, apiKey);
    const savedAt = new Date().toISOString();
    const encrypted = await encryptTikHubCredential(
      {
        version: 1,
        apiKey,
        savedAt,
        profile,
      },
      env,
    );
    return Response.json(
      {
        configured: true,
        keyHint: tikHubKeyHint(apiKey),
        savedAt,
        profile,
        message: "API Key 验证成功并已保存到当前浏览器",
      },
      {
        headers: {
          ...noStoreHeaders,
          "Set-Cookie": createTikHubCredentialCookie(encrypted, request),
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof TikHubApiError &&
      [401, 403, 422, 429, 502, 504].includes(error.status)
        ? error.status
        : 502;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "TikHub API Key 验证失败",
      },
      { status, headers: noStoreHeaders },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  return Response.json(
    {
      configured: false,
      message: "当前浏览器保存的 TikHub API Key 已移除",
    },
    {
      headers: {
        ...noStoreHeaders,
        "Set-Cookie": clearTikHubCredentialCookie(request),
      },
    },
  );
}

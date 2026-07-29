import type { AppEnv } from "@/db/runtime";

export const weeklyApiHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export const weeklyJson = (
  body: unknown,
  init?: ResponseInit,
) =>
  Response.json(body, {
    ...init,
    headers: {
      ...weeklyApiHeaders,
      ...init?.headers,
    },
  });

const digest = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

const secureEqual = async (left: string, right: string) => {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
};

export async function requireWeeklyApiKey(
  request: Request,
  env: AppEnv,
): Promise<Response | null> {
  const configured = env.WEEKLY_API_KEY?.trim();
  if (!configured || configured.length < 32) {
    return weeklyJson(
      { error: "周报 API 尚未配置" },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await secureEqual(match[1].trim(), configured))) {
    return weeklyJson({ error: "未授权" }, { status: 401 });
  }
  return null;
}

export const isValidReportId = (value: string) =>
  /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);

import type { AppEnv } from "@/db/runtime";

export interface TikHubResponse {
  code?: number;
  request_id?: string;
  message?: string;
  message_zh?: string;
  data?: unknown;
  api_key_data?: Record<string, unknown>;
  user_data?: Record<string, unknown>;
}

export interface TikHubAccountProfile {
  keyName?: string;
  emailMasked?: string;
  balance?: number;
  freeCredit?: number;
  expiresAt?: string;
}

export class TikHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TikHubApiError";
  }
}

export function normalizeTikHubApiKey(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "").trim();
}

export async function requestTikHub(
  env: AppEnv,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  token = env.TIKHUB_TOKEN,
): Promise<TikHubResponse> {
  const apiKey = normalizeTikHubApiKey(token || "");
  if (!apiKey) {
    throw new TikHubApiError("TikHub API Key 尚未配置", 401);
  }

  const baseUrl = env.TIKHUB_BASE_URL || "https://api.tikhub.io";
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: TikHubResponse = {};
    try {
      payload = text ? (JSON.parse(text) as TikHubResponse) : {};
    } catch {
      throw new TikHubApiError(
        `TikHub 返回了无法解析的响应（HTTP ${response.status}）`,
        response.status || 502,
      );
    }

    if (
      !response.ok ||
      (payload.code !== undefined && payload.code !== 200)
    ) {
      throw new TikHubApiError(
        payload.message_zh ||
          payload.message ||
          `TikHub 请求失败（HTTP ${response.status}）`,
        response.status || 502,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof TikHubApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TikHubApiError("TikHub 请求超时，请稍后重试", 504);
    }
    throw new TikHubApiError("无法连接 TikHub，请稍后重试", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function maskEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.includes("@")) return undefined;
  const [name, domain] = value.split("@");
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${domain}`;
}

export async function validateTikHubApiKey(
  env: AppEnv,
  apiKey: string,
): Promise<TikHubAccountProfile> {
  const payload = await requestTikHub(
    env,
    "/api/v1/tikhub/user/get_user_info",
    {},
    apiKey,
  );
  const keyData = payload.api_key_data || {};
  const userData = payload.user_data || {};

  return {
    keyName: optionalString(keyData.api_key_name),
    emailMasked: maskEmail(userData.email),
    balance: optionalNumber(userData.balance),
    freeCredit: optionalNumber(userData.free_credit),
    expiresAt: optionalString(keyData.expires_at),
  };
}

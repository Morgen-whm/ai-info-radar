import type { AppEnv } from "@/db/runtime";
import type { TikHubAccountProfile } from "./tikhub-client";

export const TIKHUB_CREDENTIAL_COOKIE = "trendhub_tikhub_credential";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CREDENTIAL_VERSION = 1;
const LOCAL_DEVELOPMENT_ENCRYPTION_SECRET =
  "trendhub-local-development-only-credential-key-v1";
const ENCRYPTION_CONTEXT = new TextEncoder().encode(
  "trendhub:tikhub-credential:v1",
);

export interface TikHubCredential {
  version: 1;
  apiKey: string;
  savedAt: string;
  profile: TikHubAccountProfile;
}

export function hasTikHubCredentialEncryption(env: AppEnv): boolean {
  return Boolean(getEncryptionSecret(env));
}

function getEncryptionSecret(env: AppEnv): string | undefined {
  const secret =
    env.TIKHUB_KEY_ENCRYPTION_SECRET?.trim() || env.CRON_SECRET?.trim();
  if (secret && secret.length >= 24) return secret;

  // Vite/Vinext sets NODE_ENV=development only for the local dev server.
  // Production builds fail closed and still require an explicit secret.
  return process.env.NODE_ENV === "development"
    ? LOCAL_DEVELOPMENT_ENCRYPTION_SECRET
    : undefined;
}

async function getEncryptionKey(env: AppEnv): Promise<CryptoKey> {
  const secret = getEncryptionSecret(env);
  if (!secret) {
    throw new Error(
      "服务端尚未配置 TIKHUB_KEY_ENCRYPTION_SECRET（至少 24 个字符）",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function encryptTikHubCredential(
  credential: TikHubCredential,
  env: AppEnv,
): Promise<string> {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credential));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: ENCRYPTION_CONTEXT },
    key,
    plaintext,
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function readTikHubCredential(
  cookieHeader: string | null,
  env: AppEnv,
): Promise<TikHubCredential | null> {
  if (!cookieHeader || !hasTikHubCredentialEncryption(env)) return null;
  const value = readCookie(cookieHeader, TIKHUB_CREDENTIAL_COOKIE);
  if (!value) return null;

  try {
    const [ivValue, ciphertextValue] = value.split(".");
    if (!ivValue || !ciphertextValue) return null;
    const key = await getEncryptionKey(env);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(ivValue),
        additionalData: ENCRYPTION_CONTEXT,
      },
      key,
      fromBase64Url(ciphertextValue),
    );
    const credential = JSON.parse(
      new TextDecoder().decode(decrypted),
    ) as Partial<TikHubCredential>;
    if (
      credential.version !== CREDENTIAL_VERSION ||
      typeof credential.apiKey !== "string" ||
      typeof credential.savedAt !== "string"
    ) {
      return null;
    }
    return {
      version: CREDENTIAL_VERSION,
      apiKey: credential.apiKey,
      savedAt: credential.savedAt,
      profile: credential.profile || {},
    };
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function cookieSecuritySuffix(request: Request): string {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const isSecure =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
  return isSecure ? "; Secure" : "";
}

export function createTikHubCredentialCookie(
  encryptedValue: string,
  request: Request,
): string {
  return `${TIKHUB_CREDENTIAL_COOKIE}=${encodeURIComponent(encryptedValue)}; Path=/api; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${cookieSecuritySuffix(request)}`;
}

export function clearTikHubCredentialCookie(request: Request): string {
  return `${TIKHUB_CREDENTIAL_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict${cookieSecuritySuffix(request)}`;
}

export function tikHubKeyHint(apiKey: string): string {
  return `•••• ${apiKey.slice(-4)}`;
}

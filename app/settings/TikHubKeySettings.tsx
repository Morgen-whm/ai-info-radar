"use client";

import { useEffect, useState, type FormEvent } from "react";

interface TikHubCredentialStatus {
  storageReady: boolean;
  configured: boolean;
  keyHint?: string;
  savedAt?: string;
  profile?: {
    keyName?: string;
    emailMasked?: string;
    balance?: number;
    freeCredit?: number;
    expiresAt?: string;
  };
  serverFallbackConfigured?: boolean;
  message?: string;
}

function formatAmount(value: number | undefined): string {
  if (value === undefined) return "—";
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatSavedTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function fetchTikHubStatus(): Promise<TikHubCredentialStatus> {
  const response = await fetch("/api/settings/tikhub", {
    cache: "no-store",
  });
  const payload = (await response.json()) as TikHubCredentialStatus & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "无法读取配置状态");
  return payload;
}

export function TikHubKeySettings() {
  const [status, setStatus] = useState<TikHubCredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void fetchTikHubStatus()
      .then((payload) => {
        if (active) setStatus(payload);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "无法读取配置状态",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/tikhub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = (await response.json()) as TikHubCredentialStatus & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "API Key 验证失败");
      setApiKey("");
      setShowKey(false);
      setNotice({
        tone: "success",
        text: payload.message || "API Key 已保存",
      });
      setStatus(await fetchTikHubStatus());
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "API Key 验证失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (!window.confirm("确定移除当前浏览器保存的 TikHub API Key？")) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/tikhub", {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.error || "移除失败");
      setNotice({
        tone: "success",
        text: payload.message || "API Key 已移除",
      });
      setStatus(await fetchTikHubStatus());
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "移除失败",
      });
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(status?.configured);

  return (
    <section className="panel tikhub-key-panel">
      <div className="tikhub-key-heading">
        <div>
          <span className="section-eyebrow">BRING YOUR OWN KEY</span>
          <h2>个人 TikHub API Key</h2>
          <p>
            每个浏览器独立保存。点击“立即同步”时，X 和 YouTube
            会优先使用当前使用者自己的额度。
          </p>
        </div>
        <span
          className={`credential-status ${
            configured ? "credential-ready" : "credential-empty"
          }`}
        >
          {status === null
            ? "检查中"
            : configured
              ? "已连接"
              : "未配置"}
        </span>
      </div>

      {configured ? (
        <div className="credential-summary">
          <div className="credential-key">
            <span>当前密钥</span>
            <strong>{status?.keyHint}</strong>
            <small>
              {status?.profile?.keyName || "TikHub API Key"}
              {status?.savedAt
                ? ` · ${formatSavedTime(status.savedAt)} 保存`
                : ""}
            </small>
          </div>
          <div>
            <span>账户</span>
            <strong>{status?.profile?.emailMasked || "已验证"}</strong>
          </div>
          <div>
            <span>账户余额</span>
            <strong>{formatAmount(status?.profile?.balance)}</strong>
          </div>
          <div>
            <span>免费额度</span>
            <strong>{formatAmount(status?.profile?.freeCredit)}</strong>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={removeKey}
          >
            移除密钥
          </button>
        </div>
      ) : (
        <form className="credential-form" onSubmit={saveKey}>
          <label htmlFor="tikhub-api-key">
            TikHub API Key
            <div className="secret-field">
              <input
                id="tikhub-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="粘贴 API Key，可包含或不包含 Bearer"
                autoComplete="new-password"
                spellCheck={false}
                required
                minLength={8}
                disabled={!status?.storageReady || busy}
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                disabled={!status?.storageReady || busy}
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={!status?.storageReady || busy || apiKey.trim().length < 8}
          >
            {busy ? "正在验证…" : "保存并验证"}
          </button>
        </form>
      )}

      {!status?.storageReady && status !== null ? (
        <div className="credential-message credential-message-error">
          {status.message}
        </div>
      ) : null}
      {notice ? (
        <div
          className={`credential-message ${
            notice.tone === "error"
              ? "credential-message-error"
              : "credential-message-success"
          }`}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      <div className="credential-footnote">
        <span>安全机制</span>
        <p>
          密钥经过服务端 AES-GCM 加密后写入 HttpOnly Cookie，前端脚本、数据库和接口响应都不会读取或回显完整密钥。
          定时后台采集仍使用管理员配置的服务端 Token。
        </p>
        <a
          href="https://user.tikhub.io"
          target="_blank"
          rel="noreferrer"
        >
          前往 TikHub 获取 API Key ↗
        </a>
      </div>
    </section>
  );
}

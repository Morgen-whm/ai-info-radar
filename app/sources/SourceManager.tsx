"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PlatformBadge } from "@/components/PlatformBadge";
import { formatRelativeTime } from "@/lib/format";
import { getSourceCollectionConfig } from "@/lib/source-config";
import { collectAllSources, loadLinuxFeeds, loadLinuxRss } from "@/lib/client-sync";
import { formatCollectionProgress } from "@/lib/collection-progress";
import type { Platform, Source, SourceKind } from "@/lib/types";

const kindLabels: Record<SourceKind, string> = {
  trending: "趋势榜单",
  keyword: "关键词",
  account: "账号",
  channel: "频道",
  feed: "RSS Feed",
};

function configFromForm(form: FormData) {
  return {
    maxPages: Number(form.get("maxPages") || 2),
    maxItems: Number(form.get("maxItems") || 100),
    searchType: String(form.get("searchType") || "Latest"),
    timeRange: String(form.get("timeRange") || "today"),
    sortBy: String(form.get("sortBy") || "upload_date"),
    languageCode: String(form.get("languageCode") || "en"),
    countryCode: String(form.get("countryCode") || "us"),
    filterKeywords: String(form.get("filterKeywords") || ""),
    minValueScore: Number(form.get("minValueScore") || 42),
  };
}

function SourceConfigFields({
  platform,
  kind,
  source,
}: {
  platform: Platform;
  kind: SourceKind;
  source?: Source;
}) {
  const config = getSourceCollectionConfig(
    source ?? { platform, kind, config: {} },
  );
  const isPublicFeed =
    platform === "linuxdo" ||
    platform === "idcflare" ||
    platform === "gitlab" ||
    platform === "github";
  const supportsPages =
    !isPublicFeed && kind !== "trending" && kind !== "feed";

  return (
    <>
      {supportsPages ? (
        <label>
          采集页数（1–3）
          <input
            name="maxPages"
            type="number"
            min="1"
            max="3"
            defaultValue={config.maxPages}
          />
        </label>
      ) : null}
      <label>
        单次最多内容
        <input
          name="maxItems"
          type="number"
          min="10"
          max="150"
          defaultValue={config.maxItems}
        />
      </label>
      <label>
        最低价值分（0–80）
        <input
          name="minValueScore"
          type="number"
          min="0"
          max="80"
          defaultValue={config.minValueScore}
        />
      </label>
      {platform === "x" && kind === "keyword" ? (
        <label>
          X 搜索排序
          <select name="searchType" defaultValue={config.searchType}>
            <option value="Latest">最新</option>
            <option value="Top">热门</option>
          </select>
        </label>
      ) : null}
      {platform === "youtube" && kind === "keyword" ? (
        <>
          <label>
            发布时间范围
            <select name="timeRange" defaultValue={config.timeRange}>
              <option value="last_hour">最近一小时</option>
              <option value="today">今天</option>
              <option value="this_week">本周</option>
              <option value="this_month">本月</option>
              <option value="this_year">今年</option>
            </select>
          </label>
          <label>
            YouTube 排序
            <select name="sortBy" defaultValue={config.sortBy}>
              <option value="upload_date">上传时间</option>
              <option value="relevance">相关度</option>
              <option value="view_count">播放量</option>
              <option value="rating">评分</option>
            </select>
          </label>
        </>
      ) : null}
      {platform === "youtube" ? (
        <>
          <label>
            语言代码
            <input name="languageCode" defaultValue={config.languageCode} />
          </label>
          <label>
            国家代码
            <input name="countryCode" defaultValue={config.countryCode} />
          </label>
        </>
      ) : null}
      {isPublicFeed ? (
        <label className="form-wide">
          关键词过滤（可选，逗号分隔）
          <input
            name="filterKeywords"
            defaultValue={config.filterKeywords}
            placeholder="AI, 大模型, Codex, VPS, IP, 开卡；留空采集全部"
          />
        </label>
      ) : null}
    </>
  );
}

export function SourceManager({ initialSources }: { initialSources: Source[] }) {
  const router = useRouter();
  const collectionInFlight = useRef(false);
  const [sources, setSources] = useState(initialSources);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPlatform, setNewPlatform] = useState<Platform>("x");
  const [newKind, setNewKind] = useState<SourceKind>("keyword");

  async function reloadSources() {
    const response = await fetch("/api/sources", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("数据源接口暂不可用");
    const payload = (await response.json()) as { sources: Source[] };
    setSources(payload.sources);
  }

  async function toggleSource(source: Source) {
    const next = !source.enabled;
    setSources((current) =>
      current.map((item) =>
        item.id === source.id ? { ...item, enabled: next } : item,
      ),
    );
    const response = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!response.ok) {
      setNotice("状态更新失败，已重新读取数据源");
      await reloadSources().catch(() => undefined);
    }
  }

  async function syncSource(source: Source) {
    if (collectionInFlight.current) return;
    collectionInFlight.current = true;
    setSyncing(source.id);
    setNotice("");
    try {
      const linuxRssXml = await loadLinuxRss(source);
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, linuxRssXml }),
      });
      const payload = (await response.json()) as {
        error?: string;
        itemsFound?: number;
        itemsAccepted?: number;
        itemsAdded?: number;
        credentialMode?: "personal" | "server" | "public";
      };
      if (!response.ok) throw new Error(payload.error || "同步失败");
      const modeLabel =
        payload.credentialMode === "personal"
          ? "个人 API Key"
          : payload.credentialMode === "server"
            ? "服务端 Token"
            : source.platform === "github"
              ? "GitHub 公开 API"
              : "公开 RSS";
      setNotice(
        `${source.name} 使用${modeLabel}同步完成，发现 ${payload.itemsFound ?? 0} 条，价值达标 ${payload.itemsAccepted ?? 0} 条，新增 ${payload.itemsAdded ?? 0} 条${source.platform === "github" ? "。Star 快照已保存；首日建立基线，次日开始形成完整日榜" : ""}`,
      );
      await reloadSources();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "同步失败");
    } finally {
      collectionInFlight.current = false;
      setSyncing(null);
      router.refresh();
    }
  }

  async function syncAll() {
    if (collectionInFlight.current) return;
    collectionInFlight.current = true;
    setSyncing("all");
    setNotice("正在准备监测源，采集进度将自动更新，请勿关闭页面…");
    try {
      const linuxFeeds = await loadLinuxFeeds(sources);
      let completed = 0;
      const payload = await collectAllSources(linuxFeeds, (progress) => {
        setNotice(formatCollectionProgress(progress));
        if (progress.completed > completed) {
          completed = progress.completed;
          void reloadSources().catch(() => undefined);
          router.refresh();
        }
      });
      setNotice(
        `全部采集完成：成功 ${payload.succeeded} 个，失败 ${payload.failed} 个，新增 ${payload.itemsAdded} 条`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量同步失败");
    } finally {
      collectionInFlight.current = false;
      setSyncing(null);
      // A slow refresh must not keep the collection button disabled.
      void reloadSources().catch(() => undefined);
      router.refresh();
    }
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      platform: newPlatform,
      kind: newKind,
      name: String(form.get("name")),
      target: String(form.get("target")),
      intervalMinutes: Number(form.get("intervalMinutes")),
      config: configFromForm(form),
    };
    const response = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { source?: Source; error?: string };
    if (!response.ok || !result.source) {
      setNotice(result.error || "创建失败");
      return;
    }
    setSources((current) => [...current, result.source!]);
    setShowForm(false);
    setNotice("监测源已创建");
  }

  async function saveSource(
    event: FormEvent<HTMLFormElement>,
    source: Source,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name")),
        target: String(form.get("target")),
        intervalMinutes: Number(form.get("intervalMinutes")),
        config: configFromForm(form),
      }),
    });
    const result = (await response.json()) as { source?: Source; error?: string };
    if (!response.ok || !result.source) {
      setNotice(result.error || "保存失败");
      return;
    }
    setSources((current) =>
      current.map((item) =>
        item.id === result.source!.id ? result.source! : item,
      ),
    );
    setEditingId(null);
    setNotice("监测参数已保存，下次采集立即生效");
  }

  return (
    <>
      <section className="source-toolbar">
        <div className="source-toolbar-summary">
          <strong>{sources.filter((source) => source.enabled).length}</strong>
          <span>个来源正在采集</span>
        </div>
        <div className="source-toolbar-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={syncing !== null}
            onClick={syncAll}
          >
            {syncing === "all" ? "全部采集中…" : "一键采集全部"}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "取消添加" : "+ 添加监测源"}
          </button>
        </div>
      </section>

      {showForm ? (
        <form className="source-form" onSubmit={submitSource}>
          <div className="form-heading">
            <div>
              <span className="section-eyebrow">NEW SOURCE</span>
              <h2>添加监测源</h2>
            </div>
            <p>
              TikHub 最多连续采集 3 页；Linux.do、IDCFlare 与 GitLab
              使用公开 RSS；GitHub 每日保存 Star 快照并计算增长榜。
            </p>
          </div>
          <label>
            平台
            <select
              name="platform"
              value={newPlatform}
              onChange={(event) => {
                const platform = event.target.value as Platform;
                setNewPlatform(platform);
                if (
                  platform === "linuxdo" ||
                  platform === "idcflare" ||
                  platform === "gitlab"
                ) {
                  setNewKind("feed");
                } else if (platform === "github") {
                  setNewKind("trending");
                }
              }}
            >
              <option value="x">X</option>
              <option value="youtube">YouTube</option>
              <option value="linuxdo">Linux.do</option>
              <option value="idcflare">IDCFlare</option>
              <option value="gitlab">GitLab</option>
              <option value="github">GitHub</option>
            </select>
          </label>
          <label>
            类型
            <select
              name="kind"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as SourceKind)}
            >
              <option value="keyword">关键词</option>
              <option value="trending">地区趋势</option>
              <option value="account">X 账号</option>
              <option value="channel">YouTube 频道</option>
              <option value="feed">RSS Feed</option>
            </select>
          </label>
          <label>
            显示名称
            <input name="name" required placeholder="例如：Codex 最新动态" />
          </label>
          <label className="form-wide">
            目标
            <input
              name="target"
              required
              placeholder={newPlatform === "github" ? "github://ai-star-growth" : "关键词、账号、频道 ID、地区或社区 RSS 地址"}
            />
          </label>
          <label>
            间隔（分钟）
            <input
              name="intervalMinutes"
              type="number"
              min="5"
              defaultValue="15"
              required
            />
          </label>
          <SourceConfigFields platform={newPlatform} kind={newKind} />
          <button className="button button-primary" type="submit">
            保存监测源
          </button>
        </form>
      ) : null}

      {notice ? <div className="notice" role="status" aria-live="polite">{notice}</div> : null}

      <section className="source-list">
        {sources.map((source) => {
          const config = getSourceCollectionConfig(source);
          return (
            <div className="source-card-group" key={source.id}>
              <article className="source-card">
                <div className="source-primary">
                  <PlatformBadge platform={source.platform} />
                  <div>
                    <div className="source-title-line">
                      <h2>{source.name}</h2>
                      <span className={`health-chip health-${source.status}`}>
                        {source.status === "healthy"
                          ? "正常"
                          : source.status === "warning"
                            ? "退避中"
                            : "已暂停"}
                      </span>
                    </div>
                    <p>{source.target}</p>
                    <div className="source-tags">
                      <span>{kindLabels[source.kind]}</span>
                      <span>{source.platform === "github" ? "每日快照 · 周一周榜" : `每 ${source.intervalMinutes} 分钟`}</span>
                      {source.platform === "github" ? <span>爆发项目优先</span> : null}
                      {config.maxPages > 1 ? (
                        <span>{config.maxPages} 页</span>
                      ) : null}
                      <span>最多 {config.maxItems} 条</span>
                      <span>价值 ≥ {config.minValueScore}</span>
                      <span>
                        {source.lastSyncedAt
                          ? `${formatRelativeTime(source.lastSyncedAt)}同步`
                          : "尚未真实同步"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="source-actions">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() =>
                      setEditingId((current) =>
                        current === source.id ? null : source.id,
                      )
                    }
                  >
                    {editingId === source.id ? "收起参数" : "编辑参数"}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={syncing !== null || !source.enabled}
                    onClick={() => syncSource(source)}
                  >
                    {syncing === source.id ? "同步中…" : "立即同步"}
                  </button>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={() => toggleSource(source)}
                      aria-label={`${source.enabled ? "暂停" : "启用"} ${source.name}`}
                    />
                    <span />
                  </label>
                </div>
              </article>
              {editingId === source.id ? (
                <form
                  className="source-form source-edit-form"
                  onSubmit={(event) => saveSource(event, source)}
                >
                  <div className="form-heading">
                    <div>
                      <span className="section-eyebrow">EDIT SOURCE</span>
                      <h2>{source.name}</h2>
                    </div>
                    <p>修改后从下一次采集开始生效。</p>
                  </div>
                  <label>
                    显示名称
                    <input name="name" defaultValue={source.name} required />
                  </label>
                  <label className="form-wide">
                    采集目标
                    <input name="target" defaultValue={source.target} required />
                  </label>
                  <label>
                    间隔（分钟）
                    <input
                      name="intervalMinutes"
                      type="number"
                      min="5"
                      defaultValue={source.intervalMinutes}
                      required
                    />
                  </label>
                  <SourceConfigFields
                    platform={source.platform}
                    kind={source.kind}
                    source={source}
                  />
                  <button className="button button-primary" type="submit">
                    保存修改
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}

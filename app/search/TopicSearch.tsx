"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ContentCard } from "@/components/ContentCard";
import { searchPlatforms, parseSearchOptions, type SearchOptions, type TopicSearchResponse } from "@/lib/topic-search";
import type { Platform } from "@/lib/types";

type Mode = "stored" | "live";
type SubmittedSearch = SearchOptions & { mode: Mode };

export function TopicSearch() {
  const [mode, setMode] = useState<Mode>("stored");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<Mode, Platform[]>>({
    stored: searchPlatforms.map((platform) => platform.id), live: ["x", "youtube", "github"],
  });
  const [sort, setSort] = useState<SearchOptions["sort"]>("relevance");
  const [range, setRange] = useState<SearchOptions["range"]>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TopicSearchResponse | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const live = mode === "live";
  const effectiveRange = live && range === "all" ? "month" : range;
  const platforms = selected[mode];
  const available = searchPlatforms.filter((platform) => !live || platform.live);
  const dirty = submitted && (
    submitted.mode !== mode || submitted.query !== query.trim().replace(/\s+/g, " ") ||
    submitted.sort !== sort || submitted.range !== effectiveRange ||
    submitted.platforms.join(",") !== platforms.join(",")
  );

  useEffect(() => () => {
    const controller = requestRef.current;
    requestRef.current = null;
    controller?.abort();
  }, []);

  function togglePlatform(platform: Platform) {
    setSelected((current) => ({ ...current, [mode]: current[mode].includes(platform)
      ? current[mode].filter((value) => value !== platform) : [...current[mode], platform] }));
  }

  async function search(options: SubmittedSearch, append = false) {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, options.mode === "live" ? 65_000 : 20_000);
    setBusy(true);
    setError("");
    if (!append) { setResult(null); setSubmitted(options); }
    try {
      const params = new URLSearchParams({ q: options.query, sort: options.sort, range: options.range, page: String(options.page) });
      options.platforms.forEach((platform) => params.append("platform", platform));
      const response = await fetch(options.mode === "live" ? "/api/search" : `/api/search?${params}`, {
        method: options.mode === "live" ? "POST" : "GET",
        ...(options.mode === "live" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) } : {}),
        signal: controller.signal, cache: "no-store",
      });
      const payload = await response.json() as TopicSearchResponse & { error?: string };
      if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || "搜索失败，请稍后重试");
      if (requestRef.current !== controller) return;
      setResult((previous) => append && previous ? {
        ...payload,
        items: [...new Map([...previous.items, ...payload.items].map((item) => [item.id, item])).values()],
        reviewInboxIds: [...new Set([...previous.reviewInboxIds, ...payload.reviewInboxIds])],
        rewriteJobs: [...new Map([...previous.rewriteJobs, ...payload.rewriteJobs].map((job) => [job.contentId, job])).values()],
      } : payload);
    } catch (cause) {
      if (requestRef.current !== controller) return;
      setError(controller.signal.aborted
        ? `${timedOut ? "搜索等待超时" : "已停止等待"}${options.mode === "live" ? "。后台请求可能仍在完成，已保存内容可在信息流查看，请勿立即重复搜索。" : "，可以重新搜索。"}`
        : cause instanceof Error ? cause.message : "搜索失败");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const options = parseSearchOptions({ query, platforms, sort, range: effectiveRange, page: 1 }, live);
      void search({ ...options, mode });
    } catch (cause) { setError((cause as Error).message); }
  }

  return (
    <>
      <form className="topic-search-panel" onSubmit={submit} aria-label="话题搜索条件">
        <fieldset disabled={busy}>
          <legend className="sr-only">搜索条件</legend>
          <div className="topic-search-modes" role="group" aria-label="搜索范围">
            <button type="button" aria-pressed={!live} onClick={() => setMode("stored")}>
              <strong>搜索已采集内容</strong><span>查历史资料 · 不消耗 API 额度</span>
            </button>
            <button type="button" aria-pressed={live} onClick={() => setMode("live")}>
              <strong>实时搜索平台</strong><span>找新内容 · 搜索并存入信息流</span>
            </button>
          </div>
          <label className="topic-search-query" htmlFor="topic-query">你想研究什么话题？</label>
          <div className="topic-search-input-row">
            <input id="topic-query" type="search" required maxLength={160} value={query}
              onChange={(event) => setQuery(event.target.value)} placeholder="例如：Claude Code、视频生成、VPS、开源知识库…" />
            <button className="button button-primary" type="submit" disabled={!query.trim() || !platforms.length}>
              {busy ? "搜索中…" : live ? "搜索并采集" : "开始搜索"}
            </button>
          </div>
          <fieldset className="topic-search-platforms">
            <legend>选择平台 <small>可多选</small></legend>
            <div className="topic-search-checkboxes">
              {searchPlatforms.map((platform) => {
                const unavailable = live && !platform.live;
                return <label key={platform.id} className={unavailable ? "unavailable" : ""}>
                  <input type="checkbox" checked={!unavailable && platforms.includes(platform.id)} disabled={unavailable}
                    onChange={() => togglePlatform(platform.id)} />
                  {platform.label}{unavailable && <small>仅已采集</small>}
                </label>;
              })}
              <button type="button" className="topic-search-text-button" onClick={() => setSelected((current) => ({
                ...current, [mode]: platforms.length === available.length ? [] : available.map((platform) => platform.id),
              }))}>{platforms.length === available.length ? "取消全选" : "全选可用平台"}</button>
            </div>
          </fieldset>
          <div className="topic-search-options">
            <label>时间范围<select value={effectiveRange} onChange={(event) => setRange(event.target.value as SearchOptions["range"])}>
              {!live && <option value="all">不限时间</option>}
              <option value="week">最近一周</option><option value="month">最近一个月</option><option value="year">最近一年</option>
            </select></label>
            <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as SearchOptions["sort"])}>
              <option value="relevance">相关优先</option><option value="latest">最新优先</option>
            </select></label>
          </div>
        </fieldset>
        <div className="topic-search-explanation">
          {live ? <>
            <p>X / YouTube 使用你的 TikHub Key；GitHub 使用公开 API（可配置 Token 提高额度）。每个平台只请求一页，最多保存 30 条，不代表全网全部结果。</p>
            <p>结果自动存入信息流，重复内容不会覆盖已有文章。不自动加入定时监测，不自动改写或发布。<Link href="/settings">配置 API Key →</Link></p>
            <p>时间范围由各平台解释；GitHub 按最近推送时间筛选。相关优先使用各平台排名，X 为 Top，跨平台交替展示；不限制内容语言。</p>
          </> : <p>搜索全部已入库内容的标题、正文、作者和标签，不受信息流 500 条展示上限影响。多个词用空格分隔，需同时匹配；相关优先先看标题匹配，再参考采集时价值分。</p>}
        </div>
      </form>

      <div className="topic-search-status" aria-live="polite" role="status">
        {busy ? <><span className="live-dot" /><span>{submitted?.mode === "live" ? "正在查询所选平台并保存结果，通常需要数十秒…" : "正在搜索数据库…"}</span>
          <button type="button" className="topic-search-text-button" onClick={() => requestRef.current?.abort()}>停止等待</button></>
          : submitted && result ? <span>“{submitted.query}” · {submitted.mode === "live" ? "本次返回" : "匹配"} {result.total} 条 · 已显示 {result.items.length} 条</span>
          : <span>输入关键词，勾选平台后开始搜索。</span>}
        {dirty && !busy && <span className="topic-search-changed">条件已修改，点击搜索应用新条件</span>}
      </div>
      {error && <p className="topic-search-error" role="alert">{error}</p>}
      {result?.platforms && <div className="topic-search-outcomes" aria-label="各平台搜索结果">
        {result.platforms.map((platform) => <div key={platform.platform} className={platform.status}>
          <strong>{searchPlatforms.find((item) => item.id === platform.platform)?.label}</strong>
          <span>{platform.status === "succeeded" ? `返回 ${platform.count} 条 · 新增 ${platform.added} 条` : platform.error}</span>
        </div>)}
      </div>}
      {result && !result.items.length && !busy && <section className="empty-state">
        <h2>{result.platforms?.every((platform) => platform.status === "failed") ? "本次搜索未成功" : "没有找到匹配内容"}</h2>
        <p>{result.platforms?.some((platform) => platform.status === "failed") ? "请查看上方各平台提示，再检查配置或稍后重试。" : "换一个关键词，扩大时间范围，或多勾选几个平台试试。"}</p>
      </section>}
      {result && <section className="content-grid feed-grid" aria-label="话题搜索结果" aria-busy={busy}>
        {result.items.map((item) => <ContentCard key={item.id} item={item} candidateEnabled resumeRewriteJob={false}
          initialInReviewInbox={result.reviewInboxIds.includes(item.id)}
          initialRewriteJob={result.rewriteJobs.find((job) => job.contentId === item.id) ?? null}
          onReviewInboxChange={(id) => setResult((current) => current && ({ ...current, reviewInboxIds: [...new Set([...current.reviewInboxIds, id])] }))}
          onCandidateChange={(id, selected) => setResult((current) => current && ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, isRewriteCandidate: selected } : item) }))}
          onRewriteJobChange={(job) => setResult((current) => current && ({ ...current, rewriteJobs: [...current.rewriteJobs.filter((entry) => entry.contentId !== job.contentId), job] }))}
        />)}
      </section>}
      {result?.hasMore && submitted && !dirty && <div className="feed-load-more">
        <button className="button button-secondary" type="button" disabled={busy}
          onClick={() => void search({ ...submitted, page: result.page + 1 }, true)}>{busy ? "加载中…" : "加载更多结果"}</button>
      </div>}
    </>
  );
}

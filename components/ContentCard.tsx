"use client";

import { useEffect, useRef, useState } from "react";
import { formatCompactNumber, formatRelativeTime } from "@/lib/format";
import type { ContentItem, RewriteJob } from "@/lib/types";
import { PlatformBadge } from "./PlatformBadge";
import { AuthorAvatar } from "./AuthorAvatar";
import { getValueReasons } from "@/lib/content-value";

export function ContentCard({
  item,
  candidateEnabled,
  initialInReviewInbox = false,
  initialRewriteJob = null,
  resumeRewriteJob = true,
  onCandidateChange,
  onReviewInboxChange,
  onRewriteJobChange,
}: {
  item: ContentItem;
  candidateEnabled: boolean;
  initialInReviewInbox?: boolean;
  initialRewriteJob?: RewriteJob | null;
  resumeRewriteJob?: boolean;
  onCandidateChange?: (contentId: string, selected: boolean) => void;
  onReviewInboxChange?: (contentId: string) => void;
  onRewriteJobChange?: (job: RewriteJob) => void;
}) {
  const valueReasons = getValueReasons(item);
  const [selected, setSelected] = useState(Boolean(item.isRewriteCandidate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inReviewInbox, setInReviewInbox] = useState(initialInReviewInbox);
  const [reviewInboxBusy, setReviewInboxBusy] = useState(false);
  const [reviewInboxError, setReviewInboxError] = useState("");
  const [rewriteJob, setRewriteJob] = useState(initialRewriteJob);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const runningJobRef = useRef(false);

  function rememberRewriteJob(job: RewriteJob) {
    setRewriteJob(job);
    onRewriteJobChange?.(job);
  }

  async function advanceRewriteJob(startJob: RewriteJob) {
    if (runningJobRef.current) return;
    runningJobRef.current = true;
    setRewriting(true);
    setRewriteError("");
    let current = startJob;

    try {
      for (let step = 0; step < 12; step += 1) {
        if (current.status === "completed" || current.status === "failed") break;
        const response = await fetch(
          `/api/rewrite-jobs/${encodeURIComponent(current.id)}/advance`,
          { method: "POST" },
        );
        const payload = (await response.json()) as {
          job?: RewriteJob | null;
          error?: string;
        };
        if (payload.job) {
          current = payload.job;
          rememberRewriteJob(payload.job);
        }
        if (!response.ok) {
          throw new Error(payload.error || "知识库改写任务执行失败");
        }
      }
    } catch (requestError) {
      setRewriteError(
        requestError instanceof Error
          ? requestError.message
          : "知识库改写任务执行失败",
      );
    } finally {
      setRewriting(false);
      runningJobRef.current = false;
    }
  }

  async function startRewrite() {
    if (!candidateEnabled || rewriting) return;
    if (rewriteJob?.status === "completed") {
      window.location.assign("/review");
      return;
    }

    setRewriting(true);
    setRewriteError("");
    try {
      const response = await fetch("/api/rewrite-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: item.id,
          template: "knowledge_card",
        }),
      });
      const payload = (await response.json()) as {
        job?: RewriteJob;
        error?: string;
      };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "创建知识库改写任务失败");
      }
      rememberRewriteJob(payload.job);
      if (!selected) {
        setSelected(true);
        onCandidateChange?.(item.id, true);
      }
      setRewriting(false);
      await advanceRewriteJob(payload.job);
    } catch (requestError) {
      setRewriteError(
        requestError instanceof Error
          ? requestError.message
          : "创建知识库改写任务失败",
      );
      setRewriting(false);
    }
  }

  useEffect(() => {
    if (
      resumeRewriteJob && initialRewriteJob &&
      (initialRewriteJob.status === "queued" ||
        initialRewriteJob.status === "running")
    ) {
      const timer = window.setTimeout(() => {
        void advanceRewriteJob(initialRewriteJob);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    // 只在卡片载入已有任务时恢复，后续阶段由当前执行循环推进。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRewriteJob?.id, resumeRewriteJob]);

  async function toggleCandidate() {
    if (!candidateEnabled || busy) return;
    const nextSelected = !selected;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/rewrite-candidates/${encodeURIComponent(item.id)}`,
        { method: nextSelected ? "PUT" : "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "更新改写备选失败");
      }
      setSelected(nextSelected);
      onCandidateChange?.(item.id, nextSelected);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "更新改写备选失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveToReviewInbox() {
    if (!candidateEnabled || inReviewInbox || reviewInboxBusy) return;
    setReviewInboxBusy(true);
    setReviewInboxError("");
    try {
      const response = await fetch(
        `/api/review-inbox/${encodeURIComponent(item.id)}`,
        { method: "PUT" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "存入审核中心失败");
      }
      setInReviewInbox(true);
      onReviewInboxChange?.(item.id);
    } catch (requestError) {
      setReviewInboxError(
        requestError instanceof Error
          ? requestError.message
          : "存入审核中心失败",
      );
    } finally {
      setReviewInboxBusy(false);
    }
  }

  return (
    <article className="content-card">
      <div className="content-card-top">
        <div className="source-identity">
          <PlatformBadge platform={item.platform} />
          <AuthorAvatar
            name={item.authorName}
            platform={item.platform}
            src={item.authorAvatarUrl}
          />
          <div>
            <strong>{item.authorName}</strong>
            <span>
              {item.authorHandle ? `${item.authorHandle} · ` : ""}
              {formatRelativeTime(item.publishedAt)}
            </span>
          </div>
        </div>
        <span className="mini-score" title="综合价值分，满分 100">
          <small>价值</small>
          <strong>{item.hotScore}</strong>
        </span>
      </div>
      <h3>{item.title}</h3>
      <p className="content-body">{item.body}</p>
      {item.aiSummary ? (
        <div className="ai-summary">
          <span>AI 摘要</span>
          <p>{item.aiSummary}</p>
        </div>
      ) : null}
      <div className="value-explain">
        <div>
          <span>价值依据</span>
          <p>{valueReasons.join(" · ")}</p>
        </div>
        {item.sourceName || item.sourceTarget ? (
          <div>
            <span>采集依据</span>
            <p title={item.sourceTarget}>
              {[item.sourceName, item.sourceTarget].filter(Boolean).join(" · ")}
            </p>
          </div>
        ) : null}
      </div>
      <div className="tag-list">
        {item.tags.slice(0, 4).map((tag, index) => (
          <span key={`${tag}-${index}`}>#{tag}</span>
        ))}
      </div>
      <footer className="content-footer">
        <div className="metric-list">
          {item.metrics.starGrowth24h !== undefined ? (
            <span>昨日 Star +{formatCompactNumber(item.metrics.starGrowth24h)}</span>
          ) : null}
          {item.metrics.starGrowth7d !== undefined ? (
            <span>上周 Star +{formatCompactNumber(item.metrics.starGrowth7d)}</span>
          ) : null}
          {item.metrics.stars !== undefined ? (
            <span>总 Star {formatCompactNumber(item.metrics.stars)}</span>
          ) : null}
          {item.metrics.forks !== undefined ? (
            <span>Fork {formatCompactNumber(item.metrics.forks)}</span>
          ) : null}
          {item.metrics.views !== undefined ? (
            <span>浏览 {formatCompactNumber(item.metrics.views)}</span>
          ) : null}
          {item.metrics.likes !== undefined ? (
            <span>互动 {formatCompactNumber(item.metrics.likes)}</span>
          ) : null}
          {item.metrics.reposts !== undefined ? (
            <span>转发 {formatCompactNumber(item.metrics.reposts)}</span>
          ) : null}
          {item.metrics.replies !== undefined ||
          item.metrics.comments !== undefined ? (
            <span>
              讨论{" "}
              {formatCompactNumber(
                item.metrics.replies ?? item.metrics.comments,
              )}
            </span>
          ) : null}
        </div>
        <div className="content-actions">
          <button
            type="button"
            className={
              inReviewInbox
                ? "review-inbox-button selected"
                : "review-inbox-button"
            }
            aria-pressed={inReviewInbox}
            disabled={!candidateEnabled || inReviewInbox || reviewInboxBusy}
            title={
              candidateEnabled
                ? inReviewInbox
                  ? "该信息链接已存入审核中心"
                  : "把该信息链接存入审核中心"
                : "采集真实内容后可存入审核中心"
            }
            onClick={saveToReviewInbox}
          >
            {reviewInboxBusy
              ? "存入中..."
              : inReviewInbox
                ? "已存入审核中心"
                : "存入审核中心"}
          </button>
          <button
            type="button"
            className={`rewrite-button ${rewriteJob?.status || "idle"}`}
            disabled={!candidateEnabled || rewriting}
            onClick={startRewrite}
            title={
              candidateEnabled
                ? "按项目内知识库写作策略补全来源、改写并送入人工审核"
                : "采集真实内容后可一键改写"
            }
          >
            {rewriting
              ? `${rewriteJob?.progress || 0}% 正在改写`
              : rewriteJob?.status === "completed"
                ? "进入人工审核"
                : rewriteJob?.status === "failed"
                  ? "重新改写"
                  : rewriteJob?.status === "queued" ||
                      rewriteJob?.status === "running"
                    ? "继续改写"
                    : "按知识库标准一键改写"}
          </button>
          <button
            type="button"
            className={selected ? "candidate-button selected" : "candidate-button"}
            aria-pressed={selected}
            disabled={!candidateEnabled || busy}
            title={
              candidateEnabled
                ? selected
                  ? "点击移出改写备选"
                  : "加入内容改写备选"
                : "采集真实内容后可加入改写备选"
            }
            onClick={toggleCandidate}
          >
            {busy
              ? selected
                ? "移出中..."
                : "加入中..."
              : selected
                ? "已在改写备选"
                : "加入改写备选"}
          </button>
          <a href={item.url} target="_blank" rel="noreferrer">
            原文 ↗
          </a>
        </div>
      </footer>
      {rewriteJob ? (
        <div
          className={`rewrite-job-status ${rewriteJob.status}`}
          aria-live="polite"
        >
          <span>{rewriteJob.progress}%</span>
          <p>{rewriteJob.message}</p>
          <small>{rewriteJob.profileVersion}</small>
        </div>
      ) : null}
      {error || rewriteError || reviewInboxError ? (
        <p className="candidate-error" role="alert">
          {error || rewriteError || reviewInboxError}
        </p>
      ) : null}
    </article>
  );
}

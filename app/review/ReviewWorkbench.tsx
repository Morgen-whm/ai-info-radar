"use client";

import {
  Fragment,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import type { FeishuConfigStatus } from "@/lib/feishu";
import { knowledgeCategories } from "@/lib/knowledge";
import type { WechatConfigStatus } from "@/lib/wechat-content";
import { WechatDraftPanel } from "./WechatDraftPanel";
import type {
  ContentReview,
  EditorialTemplate,
  ReviewQueueStats,
  ReviewStatus,
} from "@/lib/types";

type BusyAction =
  | "pipeline"
  | "save"
  | "approve"
  | "approve-publish"
  | "publish-site"
  | "candidate"
  | "status";

const pipelineSteps = [
  { id: "source", label: "原始内容" },
  { id: "related", label: "关联材料" },
  { id: "evidence", label: "事实证据" },
  { id: "angles", label: "写作角度" },
  { id: "draft", label: "文章初稿" },
  { id: "polished", label: "去 AI 腔" },
  { id: "fact_checked", label: "事实回查" },
  { id: "formatted", label: "排版校验" },
  { id: "human_review", label: "人工审核" },
] as const;

const pipelineStageIndex = {
  source: 0,
  related: 1,
  evidence: 2,
  angles: 3,
  draft: 4,
  polished: 5,
  fact_checked: 6,
  formatted: 7,
  human_review: 8,
} as const;

const statusLabels: Record<ReviewStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  needs_revision: "待补充",
  rejected: "已拒绝",
};

const templateLabels: Record<EditorialTemplate, string> = {
  brief: "快讯",
  knowledge_card: "知识卡片",
  deep_dive: "深度文章",
};

const platformLabels = {
  x: "X",
  youtube: "YouTube",
  linuxdo: "Linux.do",
  idcflare: "IDCFlare",
  gitlab: "GitLab",
  github: "GitHub",
};

function formatReviewAge(iso: string, renderedAt: string): string {
  const diffMinutes = Math.max(
    0,
    Math.round(
      (new Date(renderedAt).getTime() - new Date(iso).getTime()) / 60_000,
    ),
  );
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatPublishedAt(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index).replace(/\*\*/g, ""));
    nodes.push(
      <a key={`${match[2]}-${index}`} href={match[2]} target="_blank" rel="noreferrer">
        {match[1]}
      </a>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor).replace(/\*\*/g, ""));
  return nodes;
}

function previewImage(value: string): { alt: string; url: string } | null {
  const match = value.match(/^!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)$/);
  if (!match) return null;
  try {
    const url = new URL(match[2]);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { alt: match[1] || "文章来源配图", url: url.toString() };
  } catch {
    return null;
  }
}

function MarkdownPreview({ value }: { value: string }) {
  if (!value.trim()) {
    return (
      <div className="review-preview-empty">
        <strong>还没有发布稿</strong>
        <p>先生成初稿，或直接在编辑区撰写内容。</p>
      </div>
    );
  }
  return (
    <article className="review-markdown-preview">
      {value.split(/\r?\n/).map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div className="preview-space" key={index} />;
        const image = previewImage(line);
        if (image) {
          return (
            <figure key={index}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.alt}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <figcaption>{image.alt}</figcaption>
            </figure>
          );
        }
        if (line.startsWith("### ")) {
          return <h4 key={index}>{inlineMarkdown(line.slice(4))}</h4>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={index}>{inlineMarkdown(line.slice(3))}</h3>;
        }
        if (line.startsWith("# ")) {
          return <h2 key={index}>{inlineMarkdown(line.slice(2))}</h2>;
        }
        if (/^[-*]\s+/.test(line)) {
          return <p className="preview-list-item" key={index}>{inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</p>;
        }
        if (/^\d+[.)]\s+/.test(line)) {
          return <p className="preview-list-item preview-ordered" key={index}>{inlineMarkdown(line.replace(/^\d+[.)]\s+/, ""))}</p>;
        }
        if (line.startsWith("> ")) {
          return <blockquote key={index}>{inlineMarkdown(line.slice(2))}</blockquote>;
        }
        if (/^---+$/.test(line)) return <hr key={index} />;
        return <p key={index}>{inlineMarkdown(line)}</p>;
      })}
    </article>
  );
}

function updateStats(
  stats: ReviewQueueStats,
  previous: ReviewStatus,
  next: ReviewStatus,
): ReviewQueueStats {
  if (previous === next) return stats;
  const keys: Record<ReviewStatus, keyof ReviewQueueStats> = {
    pending: "pending",
    approved: "approved",
    needs_revision: "needsRevision",
    rejected: "rejected",
  };
  return {
    ...stats,
    [keys[previous]]: Math.max(0, stats[keys[previous]] - 1),
    [keys[next]]: stats[keys[next]] + 1,
  };
}

function updatePublicationStats(
  stats: ReviewQueueStats,
  previous: ContentReview,
  next: ContentReview,
): ReviewQueueStats {
  const publicationDelta =
    previous.publicationStatus === "published" &&
    next.publicationStatus !== "published"
      ? -1
      : previous.publicationStatus !== "published" &&
          next.publicationStatus === "published"
        ? 1
        : 0;
  const sitePublicationDelta =
    previous.sitePublicationStatus === "published" &&
    next.sitePublicationStatus !== "published"
      ? -1
      : previous.sitePublicationStatus !== "published" &&
          next.sitePublicationStatus === "published"
        ? 1
        : 0;
  return {
    ...stats,
    published: Math.max(0, stats.published + publicationDelta),
    sitePublished: Math.max(0, stats.sitePublished + sitePublicationDelta),
  };
}

export function ReviewWorkbench({
  initialReviews,
  initialStats,
  feishu,
  wechat,
  databaseReady,
  renderedAt,
}: {
  initialReviews: ContentReview[];
  initialStats: ReviewQueueStats;
  feishu: FeishuConfigStatus;
  wechat: WechatConfigStatus;
  databaseReady: boolean;
  renderedAt: string;
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [stats, setStats] = useState(initialStats);
  const [selectedId, setSelectedId] = useState(initialReviews[0]?.contentId || "");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [wechatDirty, setWechatDirty] = useState(false);
  const [wechatBusy, setWechatBusy] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selected = reviews.find((review) => review.contentId === selectedId) || null;
  const selectedSource = selected?.sourceSnapshot || selected?.source || null;
  const visibleReviews = useMemo(
    () =>
      reviews.filter((review) => {
        if (statusFilter !== "all" && review.status !== statusFilter) return false;
        const text = `${review.source.title} ${review.source.authorName} ${review.source.tags.join(" ")}`.toLowerCase();
        return !query || text.includes(query.toLowerCase());
      }),
    [query, reviews, statusFilter],
  );

  function replaceReview(review: ContentReview) {
    setReviews((current) =>
      current.map((item) => (item.contentId === review.contentId ? review : item)),
    );
  }

  function changeSelected(patch: Partial<ContentReview>) {
    if (!selected) return;
    replaceReview({ ...selected, ...patch });
  }

  async function requestReview(
    action: BusyAction,
    path: string,
    init: RequestInit,
    successText: string,
  ) {
    if (!selected || busy) return;
    setBusy(action);
    setNotice(null);
    const previousStatus = selected.status;
    try {
      const response = await fetch(path, init);
      const payload = (await response.json()) as {
        review?: ContentReview;
        error?: string;
        generatedBy?: "ai" | "local";
      };
      if (!response.ok || !payload.review) {
        throw new Error(payload.error || "操作失败");
      }
      replaceReview(payload.review);
      setStats((current) =>
        updatePublicationStats(
          updateStats(current, previousStatus, payload.review!.status),
          selected,
          payload.review!,
        ),
      );
      setNotice({
        tone: "success",
        text:
          payload.generatedBy === "local"
            ? `${successText}，当前未配置 AI，已使用本地结构化模板`
            : successText,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "操作失败",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runPipelineSteps(
    mode: "analysis" | "writing",
  ) {
    if (!selected || busy) return;
    if (
      mode === "writing" &&
      selected.editorContent.trim() &&
      !window.confirm("生成文章会覆盖当前编辑稿，确定继续？")
    ) {
      return;
    }
    const requestedSteps =
      mode === "analysis"
        ? ["related", "evidence", "angles"]
        : ["draft", "polish", "fact-check", "format"];
    let current = selected;
    let usedLocalFallback = false;
    setBusy("pipeline");
    setNotice(null);
    try {
      for (let index = 0; index < requestedSteps.length; index += 1) {
        const step = requestedSteps[index];
        const labels: Record<string, string> = {
          related: "正在关联同话题材料",
          evidence: "正在生成事实证据包",
          angles: "正在设计写作角度",
          draft: "正在生成文章初稿",
          polish: "正在去除 AI 腔",
          "fact-check": "正在回查文章事实",
          format: "正在校验中文排版",
        };
        setNotice({
          tone: "success",
          text: `${labels[step]}（${index + 1}/${requestedSteps.length}）`,
        });
        const response = await fetch(
          `/api/reviews/${encodeURIComponent(current.contentId)}/pipeline`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              step,
              template: current.template,
              knowledgeCategory: current.knowledgeCategory,
              selectedAngleId: current.editorialPipeline.selectedAngleId,
              editorTitle: current.editorTitle,
              editorContent: current.editorContent,
            }),
          },
        );
        const payload = (await response.json()) as {
          review?: ContentReview;
          error?: string;
          generatedBy?: "ai" | "local";
        };
        if (!response.ok || !payload.review) {
          throw new Error(payload.error || `${labels[step]}失败`);
        }
        current = payload.review;
        if (payload.generatedBy === "local") usedLocalFallback = true;
        replaceReview(current);
      }
      setNotice({
        tone: "success",
        text:
          mode === "analysis"
            ? `材料、证据与写作角度已准备好${usedLocalFallback ? "（部分使用本地保守分析）" : ""}`
            : `初稿、语言、事实与排版检查已完成${usedLocalFallback ? "（部分使用本地保守检查）" : ""}，请人工审核`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "编辑流水线执行失败",
      });
    } finally {
      setBusy(null);
    }
  }

  function save(status: ReviewStatus = selected?.status || "pending") {
    if (!selected) return;
    void requestReview(
      status === "approved" ? "approve" : status === selected.status ? "save" : "status",
      `/api/reviews/${encodeURIComponent(selected.contentId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          sourceTier: selected.sourceTier,
          template: selected.template,
          knowledgeCategory: selected.knowledgeCategory,
          aiDraft: selected.aiDraft,
          editorTitle: selected.editorTitle,
          editorContent: selected.editorContent,
          editorNote: selected.editorNote,
          reviewerName: selected.reviewerName,
          selectedAngleId: selected.editorialPipeline.selectedAngleId,
        }),
      },
      status === "approved" ? "内容已审核通过" : "审核稿已保存",
    );
  }

  async function approveAndPublishFeishu() {
    if (!selected || busy) return;
    if (!feishu.configured) {
      setNotice({ tone: "error", text: feishu.message });
      return;
    }
    if (!selected.editorTitle.trim() || !selected.editorContent.trim()) {
      setNotice({ tone: "error", text: "请先填写发布标题和正文，再上传到飞书" });
      return;
    }

    const originalReview = selected;
    let approvedReview: ContentReview | null = null;
    setBusy("approve-publish");
    setNotice(null);
    try {
      const approvalResponse = await fetch(
        `/api/reviews/${encodeURIComponent(originalReview.contentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "approved",
            sourceTier: originalReview.sourceTier,
            template: originalReview.template,
            knowledgeCategory: originalReview.knowledgeCategory,
            aiDraft: originalReview.aiDraft,
            editorTitle: originalReview.editorTitle,
            editorContent: originalReview.editorContent,
            editorNote: originalReview.editorNote,
            reviewerName: originalReview.reviewerName,
            selectedAngleId:
              originalReview.editorialPipeline.selectedAngleId,
          }),
        },
      );
      const approvalPayload = (await approvalResponse.json()) as {
        review?: ContentReview;
        error?: string;
      };
      if (!approvalResponse.ok || !approvalPayload.review) {
        throw new Error(approvalPayload.error || "审核内容保存失败");
      }
      approvedReview = approvalPayload.review;
      replaceReview(approvedReview);
      setStats((current) =>
        updatePublicationStats(
          updateStats(current, originalReview.status, approvedReview!.status),
          originalReview,
          approvedReview!,
        ),
      );

      const publishResponse = await fetch(
        `/api/reviews/${encodeURIComponent(originalReview.contentId)}/publish`,
        { method: "POST" },
      );
      const publishPayload = (await publishResponse.json()) as {
        review?: ContentReview;
        error?: string;
      };
      if (!publishResponse.ok || !publishPayload.review) {
        throw new Error(publishPayload.error || "上传飞书失败");
      }
      replaceReview(publishPayload.review);
      setStats((current) =>
        updatePublicationStats(current, approvedReview!, publishPayload.review!),
      );
      setNotice({
        tone: "success",
        text:
          originalReview.publicationStatus === "published"
            ? "审核稿已保存，飞书文档已更新"
            : "内容已审核通过并上传到飞书",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      if (approvedReview) {
        const failedReview: ContentReview = {
          ...approvedReview,
          publicationStatus: "failed",
          publishError: message,
        };
        replaceReview(failedReview);
        setStats((current) =>
          updatePublicationStats(current, approvedReview!, failedReview),
        );
      }
      setNotice({
        tone: "error",
        text: approvedReview
          ? `内容已审核通过，但上传飞书失败：${message}`
          : message,
      });
    } finally {
      setBusy(null);
    }
  }

  function publishSite() {
    if (!selected) return;
    void requestReview(
      "publish-site",
      `/api/reviews/${encodeURIComponent(selected.contentId)}/publish-site`,
      { method: "POST" },
      selected.sitePublicationStatus === "published"
        ? "知识库文章已更新"
        : "内容已发布到知识库网站",
    );
  }

  async function removeCandidate() {
    if (!selected || busy) return;
    setBusy("candidate");
    setNotice(null);
    try {
      const response = await fetch(
        `/api/rewrite-candidates/${encodeURIComponent(selected.contentId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "移出改写备选失败");
      }

      const selectedIndex = reviews.findIndex(
        (review) => review.contentId === selected.contentId,
      );
      const remaining = reviews.filter(
        (review) => review.contentId !== selected.contentId,
      );
      const nextSelected =
        remaining[selectedIndex] || remaining[Math.max(0, selectedIndex - 1)];
      const statKey: Record<ReviewStatus, keyof ReviewQueueStats> = {
        pending: "pending",
        approved: "approved",
        needs_revision: "needsRevision",
        rejected: "rejected",
      };
      setReviews(remaining);
      setSelectedId(nextSelected?.contentId || "");
      setStats((current) => ({
        ...current,
        [statKey[selected.status]]: Math.max(
          0,
          current[statKey[selected.status]] - 1,
        ),
      }));
      setNotice({ tone: "success", text: "已移出改写备选，已有编辑稿仍会保留" });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "移出改写备选失败",
      });
    } finally {
      setBusy(null);
    }
  }

  if (!databaseReady) {
    return (
      <section className="panel review-blocked-state">
        <strong>审核中心需要本地 D1 数据库</strong>
        <p>请先启动项目数据库并完成一次内容采集，随后刷新本页面。</p>
      </section>
    );
  }

  if (!reviews.length) {
    return (
      <section className="panel review-blocked-state">
        <strong>改写备选暂时为空</strong>
        <p>请先到信息流，把你认为价值高的内容加入改写备选。</p>
        <Link className="button button-primary" href="/feed">前往信息流</Link>
      </section>
    );
  }

  return (
    <>
      <section id="rewrite-review" className="review-summary" aria-label="改写审核统计">
        <button type="button" className={statusFilter === "pending" ? "active" : ""} onClick={() => setStatusFilter("pending")}>
          <span>待审核</span><strong>{stats.pending}</strong>
        </button>
        <button type="button" className={statusFilter === "needs_revision" ? "active" : ""} onClick={() => setStatusFilter("needs_revision")}>
          <span>待补充</span><strong>{stats.needsRevision}</strong>
        </button>
        <button type="button" className={statusFilter === "approved" ? "active" : ""} onClick={() => setStatusFilter("approved")}>
          <span>已通过</span><strong>{stats.approved}</strong>
        </button>
        <button type="button" className={statusFilter === "rejected" ? "active" : ""} onClick={() => setStatusFilter("rejected")}>
          <span>已拒绝</span><strong>{stats.rejected}</strong>
        </button>
        <button type="button" className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>
          <span>全部内容</span><strong>{stats.pending + stats.needsRevision + stats.approved + stats.rejected}</strong>
        </button>
      </section>

      {selected ? (
        <section className="review-pipeline" aria-label="编辑流水线进度">
          <div className="review-pipeline-heading">
            <div>
              <span>EDITORIAL PIPELINE</span>
              <strong>从来源证据到人工终审</strong>
            </div>
            <small>
              {busy === "pipeline" ? "流水线执行中，请勿切换内容" : "每一步结果都会保存，可人工复核"}
            </small>
          </div>
          <ol>
            {pipelineSteps.map((step, index) => {
              const currentIndex =
                pipelineStageIndex[selected.editorialPipeline.stage];
              const state =
                index < currentIndex
                  ? "done"
                  : index === currentIndex
                    ? "current"
                    : "pending";
              return (
                <li className={state} key={step.id}>
                  <span>{index + 1}</span>
                  <strong>{step.label}</strong>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section className="review-workbench">
        <aside className="review-queue-panel" aria-label="内容审核队列">
          <div className="review-queue-toolbar">
            <label>
              <span className="sr-only">搜索审核内容</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、标签" />
            </label>
            <span>{visibleReviews.length} 条</span>
          </div>
          <div className="review-queue-list">
            {visibleReviews.map((review) => (
              <button
                type="button"
                key={review.contentId}
                className={review.contentId === selectedId ? "review-queue-item active" : "review-queue-item"}
                onClick={() => {
                  if (wechatDirty && review.contentId !== selectedId && !window.confirm("公众号稿有未保存的修改，确定切换文章并丢弃这些修改？")) return;
                  setSelectedId(review.contentId);
                  setPreview(false);
                  setNotice(null);
                }}
                disabled={wechatBusy}
              >
                <span className={`review-status review-status-${review.status}`}>{statusLabels[review.status]}</span>
                <strong>{review.source.title}</strong>
                <small>{platformLabels[review.source.platform]}　{review.source.authorName || "作者待核对"}</small>
                <span className="review-queue-meta">
                  <b>{Math.round(review.source.hotScore)} 分</b>
                  <time>{formatReviewAge(review.source.publishedAt, renderedAt)}</time>
                </span>
              </button>
            ))}
            {!visibleReviews.length ? (
              <div className="review-list-empty">当前筛选下没有内容。</div>
            ) : null}
          </div>
        </aside>

        {selected && selectedSource ? (
          <Fragment key={selected.contentId}>
            <section className="review-source-panel">
              <div className="review-column-heading">
                <div><span>原始证据</span><strong>只读</strong></div>
                <a href={selectedSource.url} target="_blank" rel="noreferrer">打开原文</a>
              </div>
              <div className="review-source-scroll">
                <div className="review-author-row">
                  <AuthorAvatar src={selectedSource.authorAvatarUrl} name={selectedSource.authorName} platform={selectedSource.platform} />
                  <div>
                    <strong>{selectedSource.authorName || "作者待核对"}</strong>
                    <span>{selectedSource.authorHandle || selectedSource.sourceName || platformLabels[selectedSource.platform]}</span>
                  </div>
                </div>
                <h2>{selectedSource.title}</h2>
                <p className="review-source-body">{selectedSource.body || "原始正文为空，请打开来源核对完整内容。"}</p>
                {selected.editorialPipeline.sourceBundle ? (
                  <section className="review-source-bundle">
                    <div className="review-section-heading">
                      <div>
                        <span>来源补全</span>
                        <small>
                          {selected.editorialPipeline.writingProfileId} · {selected.editorialPipeline.writingProfileVersion}
                        </small>
                      </div>
                    </div>
                    <div className="review-source-bundle-stats">
                      <span>串文 {selected.editorialPipeline.sourceBundle.thread.length}</span>
                      <span>媒体 {selected.editorialPipeline.sourceBundle.media.length}</span>
                      <span>
                        字幕 {selected.editorialPipeline.sourceBundle.transcript
                          ? `${selected.editorialPipeline.sourceBundle.transcript.length.toLocaleString("zh-CN")} 字`
                          : "无"}
                      </span>
                    </div>
                    {selected.editorialPipeline.sourceBundle.warnings.length ? (
                      <div className="review-source-warnings">
                        {selected.editorialPipeline.sourceBundle.warnings.map((warning, index) => (
                          <p key={`${warning}-${index}`}>需留意 · {warning}</p>
                        ))}
                      </div>
                    ) : null}
                    {selected.editorialPipeline.sourceBundle.media.length ? (
                      <div className="review-source-media">
                        {selected.editorialPipeline.sourceBundle.media.slice(0, 6).map((media) =>
                          media.kind === "video" ? (
                            <figure key={media.id}>
                              <video controls preload="metadata" poster={media.previewUrl}>
                                <source src={media.url} type="video/mp4" />
                              </video>
                              <figcaption>{media.alt}</figcaption>
                            </figure>
                          ) : (
                            <figure key={media.id}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={media.url} alt={media.alt} loading="lazy" referrerPolicy="no-referrer" />
                              <figcaption>{media.alt}</figcaption>
                            </figure>
                          ),
                        )}
                      </div>
                    ) : null}
                    {selected.editorialPipeline.sourceBundle.thread.length ? (
                      <details className="review-source-details">
                        <summary>查看同作者串文</summary>
                        {selected.editorialPipeline.sourceBundle.thread.map((post) => (
                          <div key={post.id}>
                            <strong>{post.authorHandle || post.authorName}</strong>
                            <p>{post.text}</p>
                            {post.url ? <a href={post.url} target="_blank" rel="noreferrer">打开这条 X 帖子</a> : null}
                          </div>
                        ))}
                      </details>
                    ) : null}
                    {selected.editorialPipeline.sourceBundle.transcript ? (
                      <details className="review-source-details">
                        <summary>
                          查看 YouTube 字幕
                          {selected.editorialPipeline.sourceBundle.transcriptLanguage
                            ? ` · ${selected.editorialPipeline.sourceBundle.transcriptLanguage}`
                            : ""}
                        </summary>
                        <pre>{selected.editorialPipeline.sourceBundle.transcript}</pre>
                      </details>
                    ) : null}
                  </section>
                ) : null}
                {selectedSource.aiSummary ? (
                  <div className="review-source-summary"><span>AI 摘要</span><p>{selectedSource.aiSummary}</p></div>
                ) : null}
                <dl className="review-source-facts">
                  <div><dt>平台</dt><dd>{platformLabels[selectedSource.platform]}</dd></div>
                  <div><dt>来源</dt><dd>{selectedSource.sourceName || selectedSource.sourceId}</dd></div>
                  <div><dt>发布时间</dt><dd>{formatPublishedAt(selectedSource.publishedAt)}</dd></div>
                  <div><dt>价值分</dt><dd>{Math.round(selectedSource.hotScore)}</dd></div>
                </dl>
                <div className="review-tags">
                  {selectedSource.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
                </div>
                <section className="review-evidence-section">
                  <div className="review-section-heading">
                    <div><span>关联材料</span><small>{selected.editorialPipeline.relatedMaterials.length} 份</small></div>
                    <button type="button" onClick={() => void runPipelineSteps("analysis")} disabled={Boolean(busy)}>
                      {busy === "pipeline" ? "分析中…" : selected.editorialPipeline.relatedMaterials.length ? "重新分析" : "开始分析"}
                    </button>
                  </div>
                  {selected.editorialPipeline.relatedMaterials.length ? (
                    <div className="review-related-list">
                      {selected.editorialPipeline.relatedMaterials.map((material) => (
                        <a href={material.url} target="_blank" rel="noreferrer" key={material.contentId}>
                          <span>{platformLabels[material.platform]} · 关联 {material.relevanceScore}</span>
                          <strong>{material.title}</strong>
                          <small>{material.matchedTerms.length ? `命中：${material.matchedTerms.join(" / ")}` : "同话题背景"}</small>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="review-section-empty">尚未分析。系统会从现有内容库中寻找同事件、同实体或同主题材料。</p>
                  )}
                </section>

                <section className="review-evidence-section">
                  <div className="review-section-heading">
                    <div><span>事实证据包</span><small>{selected.editorialPipeline.evidencePack?.claims.length || 0} 条声明</small></div>
                  </div>
                  {selected.editorialPipeline.evidencePack ? (
                    <>
                      <p className="review-evidence-summary">{selected.editorialPipeline.evidencePack.summary}</p>
                      <div className="review-claim-list">
                        {selected.editorialPipeline.evidencePack.claims.map((claim) => (
                          <div key={claim.id}>
                            <span className={`evidence-support evidence-support-${claim.support}`}>
                              {claim.support === "cross_source" ? "多源印证" : claim.support === "single_source" ? "单一来源" : claim.support === "conflict" ? "存在冲突" : "待核验"}
                            </span>
                            <p>{claim.claim}</p>
                            <small>依据：{claim.sourceIds.join("、")}</small>
                          </div>
                        ))}
                      </div>
                      {selected.editorialPipeline.evidencePack.gaps.length ? (
                        <div className="review-evidence-gaps">
                          <strong>证据缺口</strong>
                          {selected.editorialPipeline.evidencePack.gaps.map((gap, index) => <p key={`${gap}-${index}`}>{gap}</p>)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="review-section-empty">关联材料后生成，所有可写事实都会绑定来源 ID。</p>
                  )}
                </section>
              </div>
            </section>

            <section className="review-editor-panel">
              <div className="review-column-heading">
                <div><span>原创发布稿</span><strong>{preview ? "网站预览" : "编辑中"}</strong></div>
                <div className="review-view-toggle">
                  <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button>
                  <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button>
                </div>
              </div>
              <div className="review-editor-scroll">
                <section className="review-angle-section">
                  <div className="review-section-heading">
                    <div><span>选择独特写作角度</span><small>先选角度，再生成文章</small></div>
                  </div>
                  {selected.editorialPipeline.writingAngles.length ? (
                    <div className="review-angle-options">
                      {selected.editorialPipeline.writingAngles.map((angle) => (
                        <label className={selected.editorialPipeline.selectedAngleId === angle.id ? "active" : ""} key={angle.id}>
                          <input
                            type="radio"
                            name={`angle-${selected.contentId}`}
                            value={angle.id}
                            checked={selected.editorialPipeline.selectedAngleId === angle.id}
                            onChange={() => changeSelected({
                              editorialPipeline: {
                                ...selected.editorialPipeline,
                                selectedAngleId: angle.id,
                              },
                            })}
                          />
                          <span>{angle.recommended ? "推荐角度" : "备选角度"}</span>
                          <strong>{angle.title}</strong>
                          <p>{angle.thesis}</p>
                          <small>{angle.readerValue}</small>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="review-section-empty">先在左侧点击“开始分析”，系统会基于证据提供三个不同角度。</p>
                  )}
                </section>
                <div className="review-editor-settings">
                  <label>知识分类<select value={selected.knowledgeCategory} onChange={(event) => changeSelected({ knowledgeCategory: event.target.value as ContentReview["knowledgeCategory"] })}>
                    {knowledgeCategories.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}
                  </select></label>
                  <label>文章模板<select value={selected.template} onChange={(event) => changeSelected({ template: event.target.value as EditorialTemplate })}>
                    {Object.entries(templateLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select></label>
                  <label>来源等级<select value={selected.sourceTier} onChange={(event) => changeSelected({ sourceTier: event.target.value as ContentReview["sourceTier"] })}>
                    <option value="S">S 级官方</option><option value="A">A 级可靠</option><option value="B">B 级线索</option><option value="C">C 级待证</option>
                  </select></label>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void runPipelineSteps("writing")}
                    disabled={Boolean(busy) || !selected.editorialPipeline.selectedAngleId}
                  >
                    {busy === "pipeline" ? "生成与质检中…" : "生成初稿并完成语言、事实与排版质检"}
                  </button>
                </div>
                {preview ? (
                  <div className="review-document-preview">
                    <h1>{selected.editorTitle || "未填写标题"}</h1>
                    <MarkdownPreview value={selected.editorContent} />
                  </div>
                ) : (
                  <div className="review-edit-form">
                    <label>发布标题<input value={selected.editorTitle} onChange={(event) => changeSelected({ editorTitle: event.target.value })} maxLength={300} placeholder="重新拟定一个准确、克制的标题" /></label>
                    <label className="review-content-field">发布正文<textarea value={selected.editorContent} onChange={(event) => changeSelected({ editorContent: event.target.value })} placeholder="使用 Markdown 编辑，支持标题、列表、引用和链接。" spellCheck={false} /></label>
                    <div className="review-editor-count">{selected.editorContent.length.toLocaleString("zh-CN")} 字符</div>
                    <div className="review-editor-notes">
                      <label>审核人<input value={selected.reviewerName} onChange={(event) => changeSelected({ reviewerName: event.target.value })} placeholder="姓名或团队角色" /></label>
                      <label>内部备注<textarea value={selected.editorNote} onChange={(event) => changeSelected({ editorNote: event.target.value })} placeholder="记录争议、待补证据或发布说明" /></label>
                    </div>
                  </div>
                )}
                <section className="review-quality-grid">
                  <div>
                    <div className="review-section-heading">
                      <div><span>事实回查</span><small>{selected.editorialPipeline.factCheck ? `${selected.editorialPipeline.factCheck.supported}/${selected.editorialPipeline.factCheck.claimsChecked} 已支撑` : "未检查"}</small></div>
                    </div>
                    {selected.editorialPipeline.factCheck ? (
                      selected.editorialPipeline.factCheck.issues.length ? (
                        <div className="review-quality-issues">
                          {selected.editorialPipeline.factCheck.issues.map((issue, index) => (
                            <div className={`severity-${issue.severity}`} key={`${issue.claim}-${index}`}>
                              <strong>{issue.status === "unsupported" ? "未支撑" : issue.status === "conflict" ? "有冲突" : "需人工判断"}</strong>
                              <p>{issue.claim}</p>
                              <small>{issue.suggestion}</small>
                            </div>
                          ))}
                        </div>
                      ) : <p className="review-check-pass">没有发现需要人工处理的事实问题。</p>
                    ) : <p className="review-section-empty">生成文章后逐条与证据包比对，不使用模型记忆补证。</p>}
                  </div>
                  <div>
                    <div className="review-section-heading">
                      <div><span>中文排版</span><small>{selected.editorialPipeline.formatCheck?.passed ? "通过" : selected.editorialPipeline.formatCheck ? "需复核" : "未检查"}</small></div>
                    </div>
                    {selected.editorialPipeline.formatCheck ? (
                      <div className="review-format-report">
                        {selected.editorialPipeline.formatCheck.fixesApplied.map((fix) => <p key={fix}>已修复 · {fix}</p>)}
                        {selected.editorialPipeline.formatCheck.issues.map((issue) => <p className="warning" key={issue}>需复核 · {issue}</p>)}
                        {!selected.editorialPipeline.formatCheck.fixesApplied.length && !selected.editorialPipeline.formatCheck.issues.length ? <p>排版规则已全部通过。</p> : null}
                      </div>
                    ) : <p className="review-section-empty">检查标题层级、列表、标点、图片和空行。</p>}
                  </div>
                </section>
              </div>
              <footer className="review-editor-footer">
                <div className="review-secondary-actions">
                  <button type="button" onClick={removeCandidate} disabled={Boolean(busy)}>{busy === "candidate" ? "移出中..." : "移出备选"}</button>
                  <button type="button" onClick={() => save("rejected")} disabled={Boolean(busy)}>拒绝</button>
                  <button type="button" onClick={() => save("needs_revision")} disabled={Boolean(busy)}>待补充</button>
                </div>
                <div className="review-primary-actions">
                  <a className="button button-secondary" href="#wechat-draft">公众号稿件 ↓</a>
                  <button className="button button-secondary" type="button" onClick={() => save()} disabled={Boolean(busy)}>{busy === "save" ? "保存中…" : "保存"}</button>
                  {selected.status !== "approved" ? (
                    <button className="button button-secondary" type="button" onClick={() => save("approved")} disabled={Boolean(busy)}>仅审核通过</button>
                  ) : null}
                  <button
                    className={selected.status !== "approved" && selected.publicationStatus !== "published" ? "button button-primary" : "button button-feishu"}
                    type="button"
                    onClick={() => void approveAndPublishFeishu()}
                    disabled={Boolean(busy) || !feishu.configured}
                    title={feishu.configured ? "保存当前审核稿并上传到飞书每日总文档" : feishu.message}
                  >
                    {busy === "approve-publish"
                      ? "审核并上传中…"
                      : selected.publicationStatus === "published"
                        ? "审核后更新飞书"
                        : selected.status === "approved"
                          ? "上传到飞书"
                          : "审核后上传到飞书"}
                  </button>
                  {selected.status === "approved" ? (
                    <button className="button button-primary" type="button" onClick={publishSite} disabled={Boolean(busy)}>{busy === "publish-site" ? "发布中…" : selected.sitePublicationStatus === "published" ? "更新网站" : "发布网站"}</button>
                  ) : null}
                </div>
              </footer>
            </section>
          </Fragment>
        ) : (
          <div className="review-no-selection">请从左侧选择一条内容。</div>
        )}
      </section>

      {selected ? <WechatDraftPanel key={selected.contentId} review={selected} config={wechat} onDirtyChange={setWechatDirty} onBusyChange={setWechatBusy} /> : null}

      <section className="review-destination-statuses">
        <div className="review-publish-status ready">
          <div><strong>知识库网站</strong><span>审核通过后发布原创终稿，当前已发布 {stats.sitePublished} 篇</span></div>
          {selected?.siteUrl ? <Link href={selected.siteUrl} target="_blank">查看网站文章</Link> : <Link href="/knowledge">打开知识库</Link>}
        </div>
        <div className={`review-publish-status ${feishu.configured ? "ready" : "warning"}`}>
          <div><strong>飞书同步（可选）</strong><span>{feishu.message}，当前已同步 {stats.published} 篇</span></div>
          {selected?.feishuUrl ? <a href={selected.feishuUrl} target="_blank" rel="noreferrer">查看飞书文档</a> : <a href="/settings">前往配置</a>}
        </div>
      </section>
      {notice ? <div className={`review-notice review-notice-${notice.tone}`} role="status">{notice.text}</div> : null}
    </>
  );
}

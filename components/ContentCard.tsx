import { formatCompactNumber, formatRelativeTime } from "@/lib/format";
import type { ContentItem } from "@/lib/types";
import { PlatformBadge } from "./PlatformBadge";
import { getValueReasons } from "@/lib/content-value";

export function ContentCard({ item }: { item: ContentItem }) {
  const valueReasons = getValueReasons(item);
  return (
    <article className="content-card">
      <div className="content-card-top">
        <div className="source-identity">
          <PlatformBadge platform={item.platform} />
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
        <a href={item.url} target="_blank" rel="noreferrer">
          原文 ↗
        </a>
      </footer>
    </article>
  );
}

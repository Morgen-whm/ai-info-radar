import type { Metadata } from "next";
import { PlatformBadge } from "@/components/PlatformBadge";
import { formatRelativeTime } from "@/lib/format";
import { getLiveTopics } from "@/lib/live-topics";
import type { Topic } from "@/lib/types";

export const metadata: Metadata = {
  title: "热点话题",
};

export const dynamic = "force-dynamic";

const sparkHeights = (topic: Topic) => {
  const start = Math.max(12, Math.round(topic.momentum * 0.45));
  const end = Math.max(start + 8, Math.min(96, topic.hotScore));
  return Array.from({ length: 8 }, (_, index) =>
    Math.round(start + ((end - start) * index) / 7),
  );
};

const sourceLabel = (platform: Topic["platforms"][number]) => {
  switch (platform) {
    case "x":
      return "X 原帖";
    case "youtube":
      return "YouTube 视频";
    case "linuxdo":
      return "Linux.do 话题";
    case "idcflare":
      return "IDCFlare 原文";
    case "gitlab":
      return "GitLab 官方内容";
  }
};

export default async function TopicsPage() {
  let topics: Topic[] = [];
  try {
    topics = await getLiveTopics({ hours: 72, limit: 20 });
  } catch {
    topics = [];
  }
  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">CROSS-PLATFORM CLUSTERS</span>
          <h1>热点话题</h1>
          <p>实时聚合最近 72 小时内容，综合价值、新鲜度、来源印证和互动热度。</p>
        </div>
      </header>
      <div className="ranking-guide">
        <strong>动态计算</strong>
        <span>价值分 55% + 新鲜度 20% + 互动热度 15% + 新闻性 10%</span>
        <span>跨平台、跨监测源和同事件多条内容会获得额外印证加分</span>
      </div>
      {topics.length ? (
        <section className="topic-board">
          {topics.map((topic, index) => (
          <article className="topic-card" id={topic.id} key={topic.id}>
            <div className="topic-card-score">
              <span>热度</span>
              <strong>{topic.hotScore}</strong>
              <small>趋势 {topic.momentum}</small>
            </div>
            <div className="topic-card-main">
              <div className="topic-card-kicker">
                <span>#{String(index + 1).padStart(2, "0")}</span>
                <span className={`topic-kind topic-kind-${topic.kind}`}>
                  {topic.kind === "topic" ? "热点话题" : "热点线索"}
                </span>
                <div className="platform-stack">
                  {topic.platforms.map((platform) => (
                    <PlatformBadge platform={platform} compact key={platform} />
                  ))}
                </div>
              </div>
              <h2>
                {topic.sources[0] ? (
                  <a
                    className="topic-title-link"
                    href={topic.sources[0].url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {topic.title}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                ) : (
                  topic.title
                )}
              </h2>
              <p>{topic.summary}</p>
              <div className="tag-list">
                {topic.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </div>
            <div className="topic-card-meta">
              <span>
                {topic.kind === "topic"
                  ? `${topic.itemCount} 条关联内容`
                  : "单条高价值线索"}
              </span>
              <span>更新于 {formatRelativeTime(topic.updatedAt)}</span>
              <div className="sparkline" aria-label="热度正在上升">
                {sparkHeights(topic).map((height, sparkIndex) => (
                  <span key={sparkIndex} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>
            {topic.sources.length ? (
              <div className="topic-card-sources">
                <span className="topic-card-sources-label">关联原文</span>
                <div className="topic-source-links">
                  {topic.sources.map((source) => (
                    <a
                      className="topic-source-link"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      title={source.title}
                      key={`${topic.id}-${source.contentId}`}
                    >
                      <PlatformBadge platform={source.platform} compact />
                      <span>{sourceLabel(source.platform)}</span>
                      <b aria-hidden="true">↗</b>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <strong>最近 72 小时暂无有效热点</strong>
          <p>系统只展示真实采集且达到最低价值门槛的内容，不再填充演示话题。</p>
        </section>
      )}
    </main>
  );
}

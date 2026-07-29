import type { Metadata } from "next";
import { PlatformBadge } from "@/components/PlatformBadge";
import { demoTopics } from "@/lib/demo-data";
import { formatRelativeTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "热点话题",
};

export default function TopicsPage() {
  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">CROSS-PLATFORM CLUSTERS</span>
          <h1>热点话题</h1>
          <p>把不同平台上描述同一事件的内容合并，观察热度和传播速度。</p>
        </div>
      </header>
      <section className="topic-board">
        {demoTopics.map((topic, index) => (
          <article className="topic-card" id={topic.id} key={topic.id}>
            <div className="topic-card-score">
              <span>热度</span>
              <strong>{topic.hotScore}</strong>
              <small>↑ {topic.momentum}%</small>
            </div>
            <div className="topic-card-main">
              <div className="topic-card-kicker">
                <span>#{String(index + 1).padStart(2, "0")}</span>
                <div className="platform-stack">
                  {topic.platforms.map((platform) => (
                    <PlatformBadge platform={platform} compact key={platform} />
                  ))}
                </div>
              </div>
              <h2>{topic.title}</h2>
              <p>{topic.summary}</p>
              <div className="tag-list">
                {topic.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </div>
            <div className="topic-card-meta">
              <span>{topic.itemCount} 条关联内容</span>
              <span>更新于 {formatRelativeTime(topic.updatedAt)}</span>
              <div className="sparkline" aria-label="热度正在上升">
                {[24, 30, 28, 42, 46, 58, 71, 86].map((height, sparkIndex) => (
                  <span key={sparkIndex} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

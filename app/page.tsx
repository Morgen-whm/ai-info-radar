import type { Metadata } from "next";
import Link from "next/link";
import { ContentCard } from "@/components/ContentCard";
import { PlatformBadge } from "@/components/PlatformBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { demoDashboard } from "@/lib/demo-data";
import { formatCompactNumber, formatRelativeTime } from "@/lib/format";
import {
  getContentStats,
  listJobs,
  listRecommendedContents,
  listSources,
} from "@/db/repository";
import type { CollectionJob, Platform, Source, Topic } from "@/lib/types";
import { QuickSyncButton } from "@/components/QuickSyncButton";
import { getLiveTopics } from "@/lib/live-topics";

export const metadata: Metadata = {
  title: "实时总览",
};

export const dynamic = "force-dynamic";

const platformLabels: Record<Platform, string> = {
  x: "X",
  youtube: "YouTube",
  linuxdo: "Linux.do",
  idcflare: "IDCFlare",
  gitlab: "GitLab",
  github: "GitHub",
};

function calculateSuccessRate(jobs: CollectionJob[]): number {
  const completed = jobs.filter(
    (job) => job.status === "succeeded" || job.status === "failed",
  );
  if (!completed.length) return 100;
  return Math.round(
    (completed.filter((job) => job.status === "succeeded").length /
      completed.length) *
      100,
  );
}

export default async function DashboardPage() {
  let latestItems = demoDashboard.latestItems;
  let sources: Source[] = demoDashboard.sources;
  let jobs: CollectionJob[] = demoDashboard.jobs;
  let totalContents = demoDashboard.stats.contents24h;
  let contents24h = demoDashboard.stats.contents24h;
  let platformCounts = demoDashboard.platformCounts;
  let usingStoredData = false;
  let hotTopics: Topic[] = [];

  try {
    const [storedItems, storedSources, storedJobs, contentStats, storedTopics] =
      await Promise.all([
        listRecommendedContents(20),
        listSources(),
        listJobs(30),
        getContentStats(),
        getLiveTopics({ hours: 72, limit: 12 }),
      ]);
    sources = storedSources;
    jobs = storedJobs;
    if (contentStats.total > 0) {
      latestItems = storedItems;
      totalContents = contentStats.total;
      contents24h = contentStats.contents24h;
      platformCounts = contentStats.platformCounts;
      usingStoredData = true;
    }
    hotTopics = storedTopics;
  } catch {
    // The dashboard keeps its demo fallback when the local DB is unavailable.
  }

  const activeSources = sources.filter((source) => source.enabled).length;
  const successRate = calculateSuccessRate(jobs);
  const topItems = latestItems.slice(0, 4);
  const totalSignals =
    platformCounts.x +
    platformCounts.youtube +
    platformCounts.linuxdo +
    platformCounts.idcflare +
    platformCounts.gitlab +
    platformCounts.github;
  const signalRows = (
    ["x", "youtube", "linuxdo", "idcflare", "gitlab", "github"] as const
  ).map((platform) => ({
    platform,
    label: platformLabels[platform],
    count: platformCounts[platform],
    percent: totalSignals
      ? Math.round((platformCounts[platform] / totalSignals) * 100)
      : 0,
  }));
  const warningSources = sources.filter(
    (source) => source.enabled && source.status !== "healthy",
  ).length;
  const statCards = [
    {
      label: "24 小时新内容",
      value: formatCompactNumber(contents24h),
      delta: usingStoredData ? "数据库实时统计" : "演示数据",
      tone: "cyan",
    },
    {
      label: "已收录内容",
      value: formatCompactNumber(totalContents),
      delta: "去重后总量",
      tone: "lime",
    },
    {
      label: "采集成功率",
      value: `${successRate}%`,
      delta: `最近 ${Math.min(jobs.length, 30)} 个任务`,
      tone: "purple",
    },
    {
      label: "活跃监测源",
      value: String(activeSources),
      delta: warningSources ? `${warningSources} 个需关注` : "全部正常",
      tone: "amber",
    },
  ];

  return (
    <main className="page-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="live-dot" />
            AI SIGNAL COMMAND CENTER
          </div>
          <h1>实时 AI 情报雷达</h1>
          <p>
            聚合 X、YouTube、Linux.do、IDCFlare、GitLab 与 GitHub，把大模型、Codex、VPS、U
            币和开发安全等碎片信息变成可追踪、可解释的热点。
          </p>
          <div className="hero-actions">
            <Link href="/feed" className="button button-primary">
              查看实时信息流
            </Link>
            <Link href="/sources" className="button button-secondary">
              管理监测源
            </Link>
            <QuickSyncButton />
          </div>
        </div>
        <div className="radar-card" aria-label="平台采集状态">
          <div className="radar-orbit orbit-one" />
          <div className="radar-orbit orbit-two" />
          <div className="radar-sweep" />
          <div className="radar-center">AI</div>
          <span className="radar-node node-x">X</span>
          <span className="radar-node node-youtube">YT</span>
          <span className="radar-node node-linux">L</span>
          <span className="radar-node node-idcflare">IF</span>
          <span className="radar-node node-gitlab">GL</span>
          <span className="radar-node node-github">GH</span>
          <div className="radar-caption">
            <strong>{activeSources}</strong>
            <span>活跃数据源</span>
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="今日统计">
        {statCards.map((stat) => (
          <article className={`stat-card tone-${stat.tone}`} key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{stat.delta}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel panel-wide">
          <SectionHeader
            eyebrow="TRENDING NOW"
            title="正在加速的话题"
            action={{ label: "查看全部", href: "/topics" }}
          />
          {hotTopics.length ? (
            <div className="topic-list">
              {hotTopics.slice(0, 4).map((topic, index) => (
                <Link href={`/topics#${topic.id}`} className="topic-row" key={topic.id}>
                  <span className="topic-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div className="topic-main">
                    <div className="topic-title-line">
                      <h3>{topic.title}</h3>
                      <span className="momentum">趋势 {topic.momentum}</span>
                    </div>
                    <p>{topic.summary}</p>
                    <div className="topic-meta">
                      <div className="platform-stack">
                        {topic.platforms.map((platform) => (
                          <PlatformBadge
                            key={platform}
                            platform={platform}
                            compact
                          />
                        ))}
                      </div>
                      <span className={`topic-kind topic-kind-${topic.kind}`}>
                        {topic.kind === "topic" ? "热点话题" : "热点线索"}
                      </span>
                      <span>
                        {topic.kind === "topic"
                          ? `${topic.itemCount} 条内容`
                          : "单条高价值内容"}
                      </span>
                      <span>{formatRelativeTime(topic.updatedAt)}</span>
                    </div>
                  </div>
                  <span className="hot-score">{topic.hotScore}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <strong>最近 72 小时暂无有效热点</strong>
              <p>完成一次真实采集后，跨来源话题会自动出现在这里。</p>
            </div>
          )}
        </div>

        <aside className="panel signal-panel">
          <SectionHeader eyebrow="SIGNAL MIX" title="平台信号分布" />
          <div className="signal-bars">
            {signalRows.map(({ platform, label, count, percent }) => (
              <div className="signal-row" key={platform}>
                <div>
                  <PlatformBadge platform={platform} compact />
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
                <div className="signal-track">
                  <span
                    className={`signal-fill signal-${platform}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="health-callout">
            <span className="health-icon">{warningSources ? "!" : "✓"}</span>
            <div>
              <strong>
                {activeSources - warningSources} 个监测源运行正常
              </strong>
              <p>
                {warningSources
                  ? `${warningSources} 个来源处于退避或暂停状态。`
                  : "当前没有采集异常。"}
              </p>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel">
        <SectionHeader
          eyebrow="LATEST INTELLIGENCE"
          title="最新高价值信息"
          action={{ label: "进入信息流", href: "/feed" }}
        />
        <div className="content-grid">
          {topItems.map((item) => (
            <ContentCard
              item={item}
              key={item.id}
              candidateEnabled={usingStoredData}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

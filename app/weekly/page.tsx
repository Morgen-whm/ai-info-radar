import type { Metadata } from "next";
import Link from "next/link";
import { PlatformBadge } from "@/components/PlatformBadge";
import { WeeklyRefreshButton } from "@/components/WeeklyRefreshButton";
import {
  getLatestWeeklyReport,
  getWeeklyReport,
  listWeeklyReportStatuses,
} from "@/db/repository";
import type {
  WeeklyReport,
  WeeklyReportStatusResult,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "AI 周报",
};

export const dynamic = "force-dynamic";

const reportIdPattern = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

const formatPeriod = (start: string, end: string) => {
  const inclusiveEnd = new Date(Date.parse(end) - 1);
  return `${formatDate(start)} — ${formatDate(inclusiveEnd.toISOString())}`;
};

const formatDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso))
    : "尚未完成";

const statusLabel: Record<WeeklyReportStatusResult["status"], string> = {
  generating: "生成中",
  ready: "已完成",
  failed: "失败",
};

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ reportId?: string }>;
}) {
  const { reportId: requestedReportId } = await searchParams;
  let histories: WeeklyReportStatusResult[] = [];
  let report: WeeklyReport | null = null;
  let loadFailed = false;

  try {
    const [latest, storedHistories] = await Promise.all([
      getLatestWeeklyReport(),
      listWeeklyReportStatuses(16),
    ]);
    histories = storedHistories;
    if (
      requestedReportId &&
      reportIdPattern.test(requestedReportId) &&
      requestedReportId !== latest?.reportId
    ) {
      report = await getWeeklyReport(requestedReportId);
    } else {
      report = latest;
    }
  } catch {
    loadFailed = true;
  }

  const categoryEntries = Object.entries(report?.stats.categoryCounts ?? {}).sort(
    (left, right) => right[1] - left[1],
  );

  return (
    <main className="page-stack">
      <header className="page-heading weekly-page-heading">
        <div>
          <span className="section-eyebrow">WEEKLY INTELLIGENCE BRIEF</span>
          <h1>AI 周报</h1>
          <p>
            将一周内的高价值信号筛选、聚类并固化为可复用快照，供团队复盘和视频项目调用。
          </p>
        </div>
        <WeeklyRefreshButton />
      </header>

      {histories.length ? (
        <section className="weekly-history" aria-label="历史周报">
          <div className="weekly-history-heading">
            <span>历史周报</span>
            <small>最近 {histories.length} 期</small>
          </div>
          <div className="weekly-history-list">
            {histories.map((history) => (
              <Link
                href={`/weekly?reportId=${history.reportId}`}
                className={
                  history.reportId === report?.reportId
                    ? "weekly-history-card active"
                    : "weekly-history-card"
                }
                key={history.reportId}
              >
                <strong>{history.reportId}</strong>
                <span>
                  {formatPeriod(history.period.start, history.period.end)}
                </span>
                <small>
                  {statusLabel[history.status]} · {history.itemCount} 条
                </small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {report ? (
        <>
          <section className="weekly-hero">
            <div className="weekly-hero-main">
              <div className="weekly-report-kicker">
                <span>{report.reportId}</span>
                <span>{formatPeriod(report.period.start, report.period.end)}</span>
                <span className={`weekly-status status-${report.status}`}>
                  {statusLabel[report.status]}
                </span>
              </div>
              <h2>{report.overview || "本期周报正在生成概览。"}</h2>
              <p>
                生成于 {formatDateTime(report.generatedAt)} · 内容指纹{" "}
                {report.contentHash?.slice(0, 12) ?? "等待生成"}
              </p>
            </div>
            <div className="weekly-stat-grid">
              <div>
                <span>候选内容</span>
                <strong>{report.stats.candidates}</strong>
              </div>
              <div>
                <span>精选事件</span>
                <strong>{report.stats.selected}</strong>
              </div>
              <div>
                <span>内容分类</span>
                <strong>{categoryEntries.length}</strong>
              </div>
            </div>
            {categoryEntries.length ? (
              <div className="weekly-category-strip">
                {categoryEntries.map(([category, count]) => (
                  <span key={category}>
                    {category}
                    <strong>{count}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {report.topics.length ? (
            <section className="weekly-topic-list">
              {report.topics.map((topic) => (
                <article className="weekly-topic-card" key={topic.id}>
                  <div className="weekly-topic-rank">
                    <span>#{String(topic.rank).padStart(2, "0")}</span>
                    <strong>{topic.score}</strong>
                    <small>综合分</small>
                  </div>
                  <div className="weekly-topic-content">
                    <div className="weekly-topic-meta">
                      <span>{topic.category}</span>
                      <span>原始价值 {topic.hotScore}</span>
                      <span>{topic.sources.length} 个来源</span>
                    </div>
                    <h2>{topic.headline}</h2>
                    <p>{topic.summary}</p>
                    <div className="weekly-insight-grid">
                      <div>
                        <span>为什么重要</span>
                        <p>{topic.whyItMatters}</p>
                      </div>
                      <div>
                        <span>视频切入角度</span>
                        <p>{topic.videoAngle}</p>
                      </div>
                    </div>
                    {topic.keywords.length ? (
                      <div className="tag-list">
                        {topic.keywords.map((keyword) => (
                          <span key={keyword}>#{keyword}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="weekly-sources">
                      {topic.sources.map((source) => (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          key={`${topic.id}-${source.contentId}`}
                        >
                          <PlatformBadge platform={source.platform} compact />
                          <span>
                            <strong>{source.sourceName || source.authorName}</strong>
                            <small>
                              {formatDate(source.publishedAt)} · 价值{" "}
                              {source.hotScore}
                            </small>
                          </span>
                          <b>打开原文 ↗</b>
                        </a>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="empty-state">
              <strong>本期没有内容达到入选标准</strong>
              <p>继续采集后再次点击“更新本周周报”，系统不会用低价值内容凑数。</p>
            </section>
          )}
        </>
      ) : (
        <section className="empty-state">
          <strong>{loadFailed ? "周报数据库暂时不可用" : "还没有生成周报"}</strong>
          <p>
            {loadFailed
              ? "请检查本地 D1 绑定，正式站点中的历史周报不受影响。"
              : "先完成一次内容采集，再点击右上角“更新本周周报”。"}
          </p>
        </section>
      )}
    </main>
  );
}

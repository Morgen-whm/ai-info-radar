import type { Metadata } from "next";
import Link from "next/link";
import { FeedExplorer } from "./FeedExplorer";
import { demoItems } from "@/lib/demo-data";
import {
  countRewriteCandidates,
  listReviewInboxLinks,
  listRecommendedContents,
  listRewriteJobsForContents,
} from "@/db/repository";
import type { RewriteJob } from "@/lib/types";

export const metadata: Metadata = {
  title: "实时信息流",
};

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  let items = demoItems;
  let usingStoredData = false;
  let candidateCount = 0;
  let rewriteJobs: RewriteJob[] = [];
  let reviewInboxIds: string[] = [];
  try {
    const [storedItems, storedCandidateCount, reviewInboxLinks] = await Promise.all([
      listRecommendedContents(500),
      countRewriteCandidates(),
      listReviewInboxLinks(),
    ]);
    if (storedItems.length) {
      items = storedItems;
      usingStoredData = true;
      candidateCount = storedCandidateCount;
      reviewInboxIds = reviewInboxLinks.map((link) => link.contentId);
      rewriteJobs = await listRewriteJobsForContents(
        storedItems.map((item) => item.id),
      );
    }
  } catch {
    // Demo data remains available when the local database is unavailable.
  }

  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">UNIFIED FEED</span>
          <h1>实时信息流</h1>
          <p>按平台、热度和关键词筛选自动采集的 AI 资讯。</p>
        </div>
        <div className="feed-heading-actions">
        <Link href="/search" className="button button-primary">话题搜索 · 自选平台 →</Link>
        <span className={usingStoredData ? "live-data-banner" : "demo-banner"}>
          {usingStoredData ? `数据库实时数据 · ${items.length} 条` : "当前展示演示数据"}
        </span>
        </div>
      </header>
      <section className="ranking-guide" aria-label="采集与推荐规则">
        <strong>采集与推荐规则</strong>
        <span>
          X / YouTube 按监测源中的关键词、账号或频道采集；Linux.do 按 RSS
          采集；IDCFlare 按站内每日热门榜采集；GitLab
          按官方博客、正式版本和安全补丁采集。
        </span>
        <span>
          默认推荐综合主题相关性、新鲜度、浏览与互动、作者影响力、内容完整度和新闻事件词，不限制内容语言。
        </span>
      </section>
      <FeedExplorer
        initialItems={items}
        initialCandidateCount={candidateCount}
        initialReviewInboxIds={reviewInboxIds}
        candidateEnabled={usingStoredData}
        initialRewriteJobs={rewriteJobs}
      />
    </main>
  );
}

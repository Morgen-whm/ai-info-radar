import type { Metadata } from "next";
import {
  getReviewQueueStats,
  listContentReviews,
  listReviewInboxLinks,
} from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { getFeishuConfigStatus } from "@/lib/feishu";
import { getWechatConfigStatus } from "@/lib/wechat";
import type {
  ContentReview,
  ReviewInboxLink,
  ReviewQueueStats,
} from "@/lib/types";
import { ReviewInboxPanel } from "./ReviewInboxPanel";
import { ReviewWorkbench } from "./ReviewWorkbench";

export const metadata: Metadata = {
  title: "内容审核中心",
};

export const dynamic = "force-dynamic";

const emptyStats: ReviewQueueStats = {
  pending: 0,
  approved: 0,
  needsRevision: 0,
  rejected: 0,
  published: 0,
  sitePublished: 0,
};

export default async function ReviewPage() {
  const env = await getAppEnv();
  let reviews: ContentReview[] = [];
  let stats = emptyStats;
  let inboxLinks: ReviewInboxLink[] = [];
  let databaseReady = true;
  try {
    [reviews, stats, inboxLinks] = await Promise.all([
      listContentReviews({ limit: 160, focus: "candidates" }),
      getReviewQueueStats("candidates"),
      listReviewInboxLinks(),
    ]);
  } catch {
    databaseReady = false;
  }

  return (
    <main className="page-stack review-page">
      <header className="page-heading review-page-heading">
        <div>
          <span className="section-eyebrow">EDITORIAL WORKSPACE</span>
          <h1>内容审核中心</h1>
          <p>处理你从信息流人工选入的高价值内容，重新组织成原创文章后发布到知识库网站。</p>
        </div>
        <span className={databaseReady ? "live-data-banner" : "demo-banner"}>
          {databaseReady
            ? `审核收件箱 ${inboxLinks.length} 条 / 改写队列 ${stats.pending + stats.needsRevision + stats.approved + stats.rejected} 条`
            : "数据库暂不可用"}
        </span>
      </header>
      {databaseReady ? (
        <nav className="review-page-tabs" aria-label="审核中心区域导航">
          <a href="#wechat-draft"><span>公众号稿件</span><strong>草稿箱</strong></a>
          <a href="#review-inbox">
            <span>审核收件箱</span>
            <strong>{inboxLinks.length}</strong>
          </a>
          <a href="#rewrite-review">
            <span>改写审核</span>
            <strong>
              {stats.pending +
                stats.needsRevision +
                stats.approved +
                stats.rejected}
            </strong>
          </a>
        </nav>
      ) : null}
      {databaseReady ? <ReviewInboxPanel links={inboxLinks} /> : null}
      <ReviewWorkbench
        initialReviews={reviews}
        initialStats={stats}
        feishu={getFeishuConfigStatus(env)}
        wechat={getWechatConfigStatus(env)}
        databaseReady={databaseReady}
        renderedAt={new Date().toISOString()}
      />
    </main>
  );
}

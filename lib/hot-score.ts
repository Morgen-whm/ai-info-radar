import type { ContentMetrics } from "./types";

export interface HotScoreInput {
  metrics: ContentMetrics;
  previousMetrics?: ContentMetrics;
  publishedAt: string;
  capturedAt?: string;
  authorFollowers?: number;
}

const finite = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

export function engagementTotal(metrics: ContentMetrics): number {
  return (
    finite(metrics.likes) +
    finite(metrics.replies) * 1.5 +
    finite(metrics.comments) * 1.5 +
    finite(metrics.shares) * 2 +
    finite(metrics.reposts) * 2 +
    finite(metrics.quotes) * 1.8 +
    finite(metrics.bookmarks) * 1.2
  );
}

export function calculateHotScore(input: HotScoreInput): number {
  const capturedAt = new Date(input.capturedAt ?? new Date().toISOString()).getTime();
  const publishedAt = new Date(input.publishedAt).getTime();
  const ageHours = Math.max(0.25, (capturedAt - publishedAt) / 3_600_000);

  const engagement = engagementTotal(input.metrics);
  const previous = engagementTotal(input.previousMetrics ?? {});
  const velocity = Math.max(0, engagement - previous) / ageHours;
  const reach = finite(input.metrics.views);
  const audience = Math.max(100, finite(input.authorFollowers));
  const engagementRate = engagement / Math.max(reach, audience, 1);

  const velocityScore = Math.min(100, Math.log10(velocity + 1) * 32);
  const engagementScore = Math.min(100, engagementRate * 1_500);
  const reachScore = Math.min(100, Math.log10(reach + 1) * 18);
  const freshnessScore = Math.max(0, 100 * Math.exp(-ageHours / 30));

  return Math.round(
    Math.min(
      100,
      velocityScore * 0.35 +
        engagementScore * 0.25 +
        reachScore * 0.2 +
        freshnessScore * 0.15 +
        5,
    ),
  );
}

export function explainHotScore(score: number): string {
  if (score >= 90) return "互动增速极高，正在快速扩散";
  if (score >= 80) return "跨来源热度上升，值得立即关注";
  if (score >= 70) return "近期讨论活跃，保持追踪";
  if (score >= 50) return "出现增长信号";
  return "常规更新";
}

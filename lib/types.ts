export type Platform =
  | "x"
  | "youtube"
  | "linuxdo"
  | "idcflare"
  | "gitlab";
export type SourceKind = "trending" | "keyword" | "account" | "channel" | "feed";
export type ContentType = "post" | "video" | "short" | "topic";

export interface Source {
  id: string;
  name: string;
  platform: Platform;
  kind: SourceKind;
  target: string;
  intervalMinutes: number;
  enabled: boolean;
  status: "healthy" | "warning" | "paused";
  lastSyncedAt: string | null;
  itemCount: number;
  config?: Record<string, string | number | boolean>;
}

export interface ContentMetrics {
  views?: number;
  likes?: number;
  replies?: number;
  comments?: number;
  shares?: number;
  reposts?: number;
  quotes?: number;
  bookmarks?: number;
  authorFollowers?: number;
}

export interface ContentItem {
  id: string;
  externalId: string;
  platform: Platform;
  sourceId: string;
  type: ContentType;
  title: string;
  body: string;
  url: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  publishedAt: string;
  fetchedAt: string;
  metrics: ContentMetrics;
  hotScore: number;
  tags: string[];
  aiSummary?: string;
  summaryStatus: "ready" | "pending" | "disabled";
  topicId?: string;
  sourceName?: string;
  sourceTarget?: string;
}

export interface TopicSource {
  contentId: string;
  platform: Platform;
  sourceName?: string;
  title: string;
  url: string;
  authorName: string;
  publishedAt: string;
  hotScore: number;
}

export interface Topic {
  id: string;
  kind: "signal" | "topic";
  title: string;
  summary: string;
  hotScore: number;
  momentum: number;
  platforms: Platform[];
  itemCount: number;
  updatedAt: string;
  tags: string[];
  sources: TopicSource[];
}

export interface CollectionJob {
  id: string;
  sourceId: string;
  sourceName: string;
  platform: Platform;
  status: "queued" | "running" | "succeeded" | "failed";
  itemsFound: number;
  itemsAdded: number;
  durationMs: number | null;
  errorMessage?: string;
  startedAt: string;
  completedAt: string | null;
}

export interface DashboardSnapshot {
  mode: "demo" | "live";
  generatedAt: string;
  stats: {
    contents24h: number;
    hotTopics: number;
    activeSources: number;
    successRate: number;
    apiRequestsToday: number;
    estimatedCostUsd: number;
  };
  platformCounts: Record<Platform, number>;
  hotTopics: Topic[];
  latestItems: ContentItem[];
  sources: Source[];
  jobs: CollectionJob[];
}

export interface NormalizedContentInput
  extends Omit<ContentItem, "id" | "sourceId" | "hotScore" | "summaryStatus"> {
  raw: unknown;
}

export interface ConnectorResult {
  items: NormalizedContentInput[];
  requestId?: string;
  nextCursor?: string;
  billable: boolean;
}

export type WeeklyReportStatus = "generating" | "ready" | "failed";

export type WeeklyReportSource = TopicSource;

export interface WeeklyReportTopic {
  id: string;
  rank: number;
  category: string;
  headline: string;
  summary: string;
  whyItMatters: string;
  videoAngle: string;
  score: number;
  hotScore: number;
  keywords: string[];
  sources: WeeklyReportSource[];
}

export interface WeeklyReportStats {
  candidates: number;
  selected: number;
  platformCounts: Partial<Record<Platform, number>>;
  categoryCounts: Record<string, number>;
}

export interface WeeklyReport {
  reportId: string;
  status: WeeklyReportStatus;
  period: {
    start: string;
    end: string;
    timezone: "Asia/Shanghai";
  };
  generatedAt: string | null;
  overview: string;
  contentHash: string | null;
  stats: WeeklyReportStats;
  topics: WeeklyReportTopic[];
  errorMessage?: string;
}

export interface WeeklyReportStatusResult {
  reportId: string;
  status: WeeklyReportStatus;
  period: WeeklyReport["period"];
  generatedAt: string | null;
  itemCount: number;
  errorMessage?: string;
}

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

export interface Topic {
  id: string;
  title: string;
  summary: string;
  hotScore: number;
  momentum: number;
  platforms: Platform[];
  itemCount: number;
  updatedAt: string;
  tags: string[];
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

export type Platform =
  | "x"
  | "youtube"
  | "linuxdo"
  | "idcflare"
  | "gitlab"
  | "github";
export type SourceKind = "trending" | "keyword" | "account" | "channel" | "feed";
export type ContentType = "post" | "video" | "short" | "topic" | "repository";

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
  stars?: number;
  forks?: number;
  openIssues?: number;
  starGrowth24h?: number;
  starGrowth7d?: number;
  starGrowthRate?: number;
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
  isRewriteCandidate?: boolean;
  rewriteCandidateAddedAt?: string;
}

export interface ReviewInboxLink {
  contentId: string;
  url: string;
  title: string;
  platform: Platform;
  authorName: string;
  addedAt: string;
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

export type ReviewStatus =
  | "pending"
  | "approved"
  | "needs_revision"
  | "rejected";

export type EditorialTemplate = "brief" | "knowledge_card" | "deep_dive";

export type KnowledgeCategory =
  | "codex_skills"
  | "open_source"
  | "overseas_practice"
  | "tested_tutorial";

export type PublicationStatus =
  | "draft"
  | "publishing"
  | "published"
  | "failed";

export type EditorialPipelineStage =
  | "source"
  | "related"
  | "evidence"
  | "angles"
  | "draft"
  | "polished"
  | "fact_checked"
  | "formatted"
  | "human_review";

export interface RelatedEditorialMaterial {
  contentId: string;
  platform: Platform;
  title: string;
  url: string;
  authorName: string;
  sourceName?: string;
  publishedAt: string;
  hotScore: number;
  relevanceScore: number;
  matchedTerms: string[];
  excerpt: string;
}

export interface EditorialEvidenceClaim {
  id: string;
  claim: string;
  type: "fact" | "context" | "opinion";
  support: "cross_source" | "single_source" | "unverified" | "conflict";
  sourceIds: string[];
  note?: string;
}

export interface EditorialEvidencePack {
  subject: string;
  summary: string;
  claims: EditorialEvidenceClaim[];
  conflicts: string[];
  gaps: string[];
  sourceCount: number;
  generatedAt: string;
}

export interface EditorialWritingAngle {
  id: string;
  title: string;
  thesis: string;
  readerValue: string;
  outline: string[];
  novelty: string;
  evidenceClaimIds: string[];
  risks: string[];
  recommended: boolean;
}

export interface EditorialFactCheckIssue {
  claim: string;
  severity: "high" | "medium" | "low";
  status: "supported" | "partially_supported" | "unsupported" | "conflict";
  sourceIds: string[];
  suggestion: string;
}

export interface EditorialFactCheckReport {
  checkedAt: string;
  claimsChecked: number;
  supported: number;
  needsReview: number;
  issues: EditorialFactCheckIssue[];
}

export interface EditorialFormatCheckReport {
  checkedAt: string;
  passed: boolean;
  issues: string[];
  fixesApplied: string[];
}

export interface EditorialThreadItem {
  id: string;
  kind: "primary" | "thread" | "quoted" | "comment";
  text: string;
  authorName: string;
  authorHandle?: string;
  url?: string;
  publishedAt?: string;
}

export interface EditorialMediaAsset {
  id: string;
  kind: "image" | "video" | "thumbnail";
  url: string;
  previewUrl?: string;
  alt: string;
  sourceUrl: string;
}

export interface EditorialSourceBundle {
  contentId: string;
  platform: Platform;
  fullText: string;
  description?: string;
  transcript?: string;
  transcriptLanguage?: string;
  thread: EditorialThreadItem[];
  media: EditorialMediaAsset[];
  chapters: string[];
  warnings: string[];
  requestIds: string[];
  enrichedAt: string;
}

export interface EditorialPipeline {
  stage: EditorialPipelineStage;
  writingProfileId: string;
  writingProfileVersion: string;
  sourceBundle: EditorialSourceBundle | null;
  relatedMaterials: RelatedEditorialMaterial[];
  evidencePack: EditorialEvidencePack | null;
  writingAngles: EditorialWritingAngle[];
  selectedAngleId: string;
  factCheck: EditorialFactCheckReport | null;
  formatCheck: EditorialFormatCheckReport | null;
  lastError?: string;
  updatedAt: string;
}

export type RewriteJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type RewriteJobStage =
  | "queued"
  | "enriching"
  | "related"
  | "evidence"
  | "angles"
  | "draft"
  | "polish"
  | "fact_check"
  | "format"
  | "human_review";

export interface RewriteJob {
  id: string;
  contentId: string;
  status: RewriteJobStatus;
  stage: RewriteJobStage;
  progress: number;
  message: string;
  profileId: string;
  profileVersion: string;
  template: EditorialTemplate;
  knowledgeCategory: KnowledgeCategory;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ContentReview {
  id: string;
  contentId: string;
  status: ReviewStatus;
  sourceTier: "S" | "A" | "B" | "C";
  template: EditorialTemplate;
  knowledgeCategory: KnowledgeCategory;
  sourceSnapshot: ContentItem;
  aiDraft: string;
  editorTitle: string;
  editorContent: string;
  editorNote: string;
  reviewerName: string;
  editorialPipeline: EditorialPipeline;
  reviewedAt: string | null;
  publicationStatus: PublicationStatus;
  feishuDocumentId?: string;
  feishuWikiNodeToken?: string;
  feishuUrl?: string;
  publishedContentHash?: string;
  publishedAt: string | null;
  publishError?: string;
  sitePublicationStatus: PublicationStatus;
  knowledgeArticleId?: string;
  siteUrl?: string;
  sitePublishedAt: string | null;
  sitePublishError?: string;
  createdAt: string;
  updatedAt: string;
  source: ContentItem;
}

export interface ReviewQueueStats {
  pending: number;
  approved: number;
  needsRevision: number;
  rejected: number;
  published: number;
  sitePublished: number;
}

export interface KnowledgeArticle {
  id: string;
  contentId: string;
  slug: string;
  category: KnowledgeCategory;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  sourceSnapshot: ContentItem;
  tags: string[];
  status: "published" | "archived";
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

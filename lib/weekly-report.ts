import {
  beginWeeklyReport,
  completeWeeklyReport,
  failWeeklyReport,
  getWeeklyReport,
  listContentsByPeriod,
} from "@/db/repository";
import {
  matchedValueTopics,
  recommendationScore,
} from "@/lib/content-value";
import type {
  ContentItem,
  Platform,
  WeeklyReport,
  WeeklyReportSource,
  WeeklyReportStats,
  WeeklyReportTopic,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_TOPICS = 12;
const MIN_VALUE_SCORE = 52;
const TIMEZONE = "Asia/Shanghai" as const;

const categoryRules = [
  {
    category: "安全事件",
    terms: [
      "security",
      "vulnerability",
      "cve-",
      "exploit",
      "breach",
      "安全",
      "漏洞",
      "攻击",
      "补丁",
    ],
  },
  {
    category: "支付、订阅与开卡",
    terms: [
      "payment",
      "credit card",
      "virtual card",
      "subscription",
      "usdt",
      "crypto",
      "银行卡",
      "虚拟卡",
      "开卡",
      "支付",
      "订阅",
      "u币",
    ],
  },
  {
    category: "AI 基础设施、VPS 与算力",
    terms: [
      "vps",
      "gpu",
      "cuda",
      "inference",
      "datacenter",
      "data center",
      "server",
      "cloud",
      "算力",
      "推理",
      "服务器",
      "云服务",
      "数据中心",
    ],
  },
  {
    category: "Codex、Agent 与开发工具",
    terms: [
      "codex",
      "agent",
      "agentic",
      "mcp",
      "cursor",
      "claude code",
      "coding assistant",
      "智能体",
      "编程助手",
      "开发工具",
    ],
  },
  {
    category: "开源项目与研究",
    terms: [
      "open source",
      "github",
      "gitlab",
      "paper",
      "research",
      "benchmark",
      "开源",
      "论文",
      "研究",
      "评测",
    ],
  },
] as const;

const newsTerms = [
  "release",
  "launch",
  "introducing",
  "announce",
  "update",
  "open source",
  "benchmark",
  "research",
  "security",
  "发布",
  "推出",
  "上线",
  "更新",
  "开源",
  "研究",
  "安全",
  "漏洞",
  "正式版",
];

const whyItMattersByCategory: Record<string, string> = {
  "大模型与产品发布":
    "这类变化会直接影响模型能力、产品选择和下一阶段 AI 应用机会。",
  "Codex、Agent 与开发工具":
    "这类进展会改变开发效率、自动化边界和团队采用 AI 编程的方式。",
  "开源项目与研究":
    "它提供了可验证的新方法、开放实现或性能基准，适合进一步实测。",
  "AI 基础设施、VPS 与算力":
    "它关系到部署成本、推理效率和 AI 服务的稳定可用性。",
  安全事件: "它可能影响现有系统、开发供应链或线上服务，需要及时评估风险。",
  "支付、订阅与开卡":
    "它关系到海外 AI 服务的订阅、支付可用性和实际使用成本。",
};

const videoAngleByCategory: Record<string, string> = {
  "大模型与产品发布": "用“本周最值得关注的新模型/新产品”做能力与影响对比。",
  "Codex、Agent 与开发工具": "用真实工作流演示它能节省什么、仍有哪些限制。",
  "开源项目与研究": "拆解核心方法，并给出是否值得普通用户跟进的结论。",
  "AI 基础设施、VPS 与算力": "围绕成本、配置和使用场景做一页式决策分析。",
  安全事件: "用事件时间线说明影响范围、风险和应对动作。",
  "支付、订阅与开卡": "从可用地区、费用、风险和适用人群四点讲清楚。",
};

export interface WeeklyPeriod {
  reportId: string;
  start: string;
  end: string;
  weekStart: string;
}

interface RankedCandidate {
  item: ContentItem;
  category: string;
  baseScore: number;
  topics: string[];
}

interface StoryCluster {
  category: string;
  representative: RankedCandidate;
  candidates: RankedCandidate[];
  score: number;
}

const dateOnlyInShanghai = (date: Date) => {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

const isoWeekId = (mondayDate: string) => {
  const [year, month, day] = mondayDate.split("-").map(Number);
  const monday = Date.UTC(year, month - 1, day);
  const thursday = new Date(monday + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
  const dayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const weekOneMonday = januaryFourth.getTime() - dayOffset * DAY_MS;
  const week = Math.floor((monday - weekOneMonday) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
};

export function resolveWeeklyPeriod(
  requestedWeekStart?: string,
  now = new Date(),
): WeeklyPeriod {
  let weekStart = requestedWeekStart?.trim();
  if (weekStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw new Error("weekStart 必须使用 YYYY-MM-DD 格式");
    }
    const timestamp = Date.parse(`${weekStart}T00:00:00+08:00`);
    const localDay = new Date(timestamp + 8 * 60 * 60 * 1_000);
    if (
      !Number.isFinite(timestamp) ||
      dateOnlyInShanghai(new Date(timestamp)) !== weekStart ||
      localDay.getUTCDay() !== 1
    ) {
      throw new Error("weekStart 必须是有效的周一日期");
    }
  } else {
    const localNow = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
    const localMidnightUtc = Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate(),
    );
    const daysSinceMonday = (localNow.getUTCDay() + 6) % 7;
    const previousMondayLocal =
      localMidnightUtc - (daysSinceMonday + 7) * DAY_MS;
    weekStart = new Date(previousMondayLocal).toISOString().slice(0, 10);
  }

  const startMs = Date.parse(`${weekStart}T00:00:00+08:00`);
  return {
    reportId: isoWeekId(weekStart),
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 7 * DAY_MS).toISOString(),
    weekStart,
  };
}

const classify = (item: ContentItem) => {
  const text = `${item.title} ${item.body} ${item.tags.join(" ")}`.toLowerCase();
  return (
    categoryRules.find((rule) =>
      rule.terms.some((term) => text.includes(term)),
    )?.category ?? "大模型与产品发布"
  );
};

const candidateScore = (
  item: ContentItem,
  period: WeeklyPeriod,
  now: Date,
) => {
  const referenceTime = Math.min(now.getTime(), Date.parse(period.end));
  const published = Date.parse(item.publishedAt);
  const ageHours = Number.isFinite(published)
    ? Math.max(0, (referenceTime - published) / 3_600_000)
    : 168;
  const freshness = Math.max(0, 10 * (1 - ageHours / 168));
  const text = `${item.title} ${item.body}`.toLowerCase();
  const newsBonus = Math.min(
    8,
    newsTerms.filter((term) => text.includes(term)).length * 2,
  );
  const officialBonus = item.platform === "gitlab" ? 5 : 0;
  const completenessBonus =
    (item.authorName && item.authorName !== "未知作者" ? 2 : 0) +
    (item.aiSummary ? 2 : 0);
  return Math.round(
    (recommendationScore(item) +
      freshness +
      newsBonus +
      officialBonus +
      completenessBonus) *
      10,
  ) / 10;
};

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "new",
  "update",
  "release",
  "about",
  "your",
  "you",
]);

const titleTokens = (title: string) => {
  const normalized = title.normalize("NFKC").toLowerCase();
  const chunks = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = new Set<string>();
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      if (chunk.length === 1) tokens.add(chunk);
      for (let index = 0; index < chunk.length - 1; index += 1) {
        tokens.add(chunk.slice(index, index + 2));
      }
    } else if (chunk.length > 2 && !stopWords.has(chunk)) {
      tokens.add(chunk);
    }
  }
  return tokens;
};

const jaccard = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
};

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
};

const sameStory = (left: RankedCandidate, right: RankedCandidate) => {
  if (normalizeUrl(left.item.url) === normalizeUrl(right.item.url)) return true;
  if (left.category !== right.category) return false;
  return jaccard(titleTokens(left.item.title), titleTokens(right.item.title)) >= 0.66;
};

const clusterCandidates = (candidates: RankedCandidate[]) => {
  const clusters: StoryCluster[] = [];
  for (const candidate of candidates.sort(
    (left, right) => right.baseScore - left.baseScore,
  )) {
    const existing = clusters.find((cluster) =>
      sameStory(cluster.representative, candidate),
    );
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    clusters.push({
      category: candidate.category,
      representative: candidate,
      candidates: [candidate],
      score: candidate.baseScore,
    });
  }

  for (const cluster of clusters) {
    const platforms = new Set(
      cluster.candidates.map((candidate) => candidate.item.platform),
    );
    cluster.score =
      Math.round(
        (cluster.representative.baseScore +
          Math.min(
            10,
            Math.max(0, platforms.size - 1) * 5 +
              Math.max(0, cluster.candidates.length - 1) * 2,
          )) *
          10,
      ) / 10;
  }
  return clusters.sort((left, right) => right.score - left.score);
};

const balancedSelection = (clusters: StoryCluster[]) => {
  const selected: StoryCluster[] = [];
  const platformCounts = new Map<Platform, number>();
  const categoryCounts = new Map<string, number>();

  for (const cluster of clusters) {
    if (selected.length >= MAX_TOPICS) break;
    const platform = cluster.representative.item.platform;
    if ((platformCounts.get(platform) ?? 0) >= 5) continue;
    if ((categoryCounts.get(cluster.category) ?? 0) >= 4) continue;
    selected.push(cluster);
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    categoryCounts.set(
      cluster.category,
      (categoryCounts.get(cluster.category) ?? 0) + 1,
    );
  }

  if (selected.length < MAX_TOPICS) {
    for (const cluster of clusters) {
      if (selected.length >= MAX_TOPICS) break;
      if (!selected.includes(cluster)) selected.push(cluster);
    }
  }
  return selected;
};

const cleanText = (value: string) =>
  value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const excerpt = (value: string, maximum = 240) => {
  const text = cleanText(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1).trim()}…`;
};

const sourceReference = (candidate: RankedCandidate): WeeklyReportSource => ({
  contentId: candidate.item.id,
  platform: candidate.item.platform,
  sourceName: candidate.item.sourceName,
  title: candidate.item.title,
  url: candidate.item.url,
  authorName: candidate.item.authorName || "未知作者",
  publishedAt: candidate.item.publishedAt,
  hotScore: candidate.item.hotScore,
});

const clusterToTopic = (
  cluster: StoryCluster,
  rank: number,
): WeeklyReportTopic => {
  const representative = cluster.representative;
  const sourceCandidates = [...cluster.candidates].sort(
    (left, right) => right.baseScore - left.baseScore,
  );
  const sourceUrls = new Set<string>();
  const sources = sourceCandidates
    .filter((candidate) => {
      const normalized = normalizeUrl(candidate.item.url);
      if (sourceUrls.has(normalized)) return false;
      sourceUrls.add(normalized);
      return true;
    })
    .slice(0, 3)
    .map(sourceReference);
  const summarySource =
    representative.item.aiSummary ||
    representative.item.body ||
    representative.item.title;
  const keywords = [
    ...representative.topics,
    ...representative.item.tags,
  ]
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .filter((keyword, index, values) => values.indexOf(keyword) === index)
    .slice(0, 8);

  return {
    id: `${representative.item.id}-${rank}`,
    rank,
    category: cluster.category,
    headline: excerpt(representative.item.title, 160),
    summary: excerpt(summarySource, 260),
    whyItMatters: whyItMattersByCategory[cluster.category],
    videoAngle: videoAngleByCategory[cluster.category],
    score: cluster.score,
    hotScore: representative.item.hotScore,
    keywords,
    sources,
  };
};

const reportStats = (
  candidates: RankedCandidate[],
  topics: WeeklyReportTopic[],
): WeeklyReportStats => {
  const platformCounts: Partial<Record<Platform, number>> = {};
  const categoryCounts: Record<string, number> = {};
  for (const topic of topics) {
    const platform = topic.sources[0]?.platform;
    if (platform) {
      platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;
    }
    categoryCounts[topic.category] =
      (categoryCounts[topic.category] ?? 0) + 1;
  }
  return {
    candidates: candidates.length,
    selected: topics.length,
    platformCounts,
    categoryCounts,
  };
};

const overviewFrom = (stats: WeeklyReportStats) => {
  const categories = Object.entries(stats.categoryCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => category);
  if (!stats.selected) {
    return `本周扫描到 ${stats.candidates} 条相关候选，但没有内容达到周报入选标准。`;
  }
  return `本周从 ${stats.candidates} 条高相关候选中精选 ${stats.selected} 条，重点集中在${categories.join("、")}。`;
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export async function generateWeeklyReport(options?: {
  weekStart?: string;
  force?: boolean;
  now?: Date;
}): Promise<{ report: WeeklyReport; reused: boolean }> {
  const now = options?.now ?? new Date();
  const period = resolveWeeklyPeriod(options?.weekStart, now);
  const existing = await getWeeklyReport(period.reportId);
  if (existing?.status === "ready" && !options?.force) {
    return { report: existing, reused: true };
  }

  await beginWeeklyReport(period.reportId, period.start, period.end);
  try {
    const items = await listContentsByPeriod(period.start, period.end);
    const ranked = items
      .map((item) => {
        const topics = matchedValueTopics(item);
        return {
          item,
          category: classify(item),
          baseScore: candidateScore(item, period, now),
          topics,
        };
      })
      .filter(
        (candidate) =>
          candidate.item.hotScore >= MIN_VALUE_SCORE &&
          (candidate.topics.length > 0 ||
            candidate.item.platform === "gitlab"),
      );

    const candidates =
      ranked.length >= 6
        ? ranked
        : items
            .map((item) => ({
              item,
              category: classify(item),
              baseScore: candidateScore(item, period, now),
              topics: matchedValueTopics(item),
            }))
            .filter(
              (candidate) =>
                candidate.item.hotScore >= 42 &&
                (candidate.topics.length > 0 ||
                  candidate.item.platform === "gitlab"),
            );
    const selected = balancedSelection(clusterCandidates(candidates));
    const topics = selected.map(clusterToTopic);
    const stats = reportStats(candidates, topics);
    const generatedAt = now.toISOString();
    const contentHash = await sha256(
      JSON.stringify({
        period: { start: period.start, end: period.end },
        topics,
      }),
    );
    const report: WeeklyReport = {
      reportId: period.reportId,
      status: "ready",
      period: {
        start: period.start,
        end: period.end,
        timezone: TIMEZONE,
      },
      generatedAt,
      overview: overviewFrom(stats),
      contentHash,
      stats,
      topics,
    };
    await completeWeeklyReport(report);
    return { report, reused: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "周报生成过程中发生未知错误";
    await failWeeklyReport(period.reportId, message);
    throw error;
  }
}

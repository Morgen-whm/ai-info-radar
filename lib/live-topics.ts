import { listContentsByPeriod } from "@/db/repository";
import { matchedValueTopics } from "@/lib/content-value";
import { engagementTotal } from "@/lib/hot-score";
import type { ContentItem, Platform, Topic } from "@/lib/types";

const HOUR_MS = 60 * 60 * 1_000;
const DEFAULT_WINDOW_HOURS = 72;

interface RankedItem {
  item: ContentItem;
  score: number;
  freshness: number;
  engagement: number;
  topics: string[];
}

interface TopicCluster {
  representative: RankedItem;
  items: RankedItem[];
  score: number;
  momentum: number;
}

interface StorySignature {
  key: string;
  entity: string;
  event: string;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const finite = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

const newsTerms = [
  "release",
  "released",
  "launch",
  "launched",
  "introducing",
  "announce",
  "announced",
  "update",
  "updated",
  "benchmark",
  "security",
  "vulnerability",
  "outage",
  "发布",
  "推出",
  "上线",
  "更新",
  "开源",
  "适配",
  "宣布",
  "正式",
  "更名",
  "攻击",
  "漏洞",
  "补丁",
  "报错",
  "故障",
  "重置",
  "验证银行卡",
  "涨价",
  "降价",
];

const scoreItem = (item: ContentItem, now: number): RankedItem => {
  const published = Date.parse(item.publishedAt);
  const ageHours = Number.isFinite(published)
    ? Math.max(0, (now - published) / HOUR_MS)
    : DEFAULT_WINDOW_HOURS;
  const freshness = 100 * Math.exp(-ageHours / 30);
  const views = finite(item.metrics.views);
  const interactions = engagementTotal(item.metrics);
  const reachScore = clamp((Math.log10(views + 1) / 6) * 100);
  const interactionScore = clamp((Math.log10(interactions + 1) / 4.5) * 100);
  const engagement = reachScore * 0.45 + interactionScore * 0.55;
  const text = `${item.title} ${item.body}`.toLowerCase();
  const newsworthiness = clamp(
    newsTerms.filter((term) => text.includes(term)).length * 24,
  );
  const promotionPenalty =
    /优惠码|返佣|抽奖|拼车|人找车|车找人|求推荐|求助|请教|限量秒杀|\bcoupon\b|\breferral\b/.test(
      text,
    )
      ? 20
      : 0;
  const officialBonus = item.platform === "gitlab" ? 7 : 0;
  const score = clamp(
    item.hotScore * 0.55 +
      freshness * 0.2 +
      engagement * 0.15 +
      newsworthiness * 0.1 +
      officialBonus -
      promotionPenalty,
  );
  return {
    item,
    score: Math.round(score * 10) / 10,
    freshness,
    engagement,
    topics: matchedValueTopics(item),
  };
};

const storySignature = (title: string): StorySignature | null => {
  const text = title.normalize("NFKC").toLowerCase();
  const entity = [
    { key: "codex", label: "Codex", pattern: /\bcodex\b/ },
    { key: "claude", label: "Claude", pattern: /\bclaude\b/ },
    {
      key: "openai",
      label: "OpenAI / GPT",
      pattern: /\bopenai\b|\bchatgpt\b|\bgpt(?:-|[\s\d])/,
    },
    { key: "gemini", label: "Gemini", pattern: /\bgemini\b/ },
    { key: "kimi", label: "Kimi", pattern: /\bkimi\b/ },
    { key: "gitlab", label: "GitLab", pattern: /\bgitlab\b/ },
    {
      key: "vps",
      label: "VPS",
      pattern: /\bvps\b|服务器|主机|cloud server/,
    },
  ].find((entry) => entry.pattern.test(text));
  const event = [
    { key: "reset", label: "额度重置", pattern: /重置|\breset/ },
    {
      key: "ban",
      label: "账号风控",
      pattern: /封禁|被封|封号|\bban(?:ned)?\b|suspend/,
    },
    {
      key: "error",
      label: "服务异常",
      pattern: /报错|故障|不可用|\berror\b|\boutage\b|\bdowntime\b/,
    },
    {
      key: "security",
      label: "安全事件",
      pattern: /攻击|漏洞|补丁|\battack\b|\bvulnerability\b|\bcve-/,
    },
    {
      key: "release",
      label: "产品更新",
      pattern:
        /发布|推出|上线|更新|适配|更名|\brelease\b|\blaunch\b|\bupdate\b/,
    },
    {
      key: "pricing",
      label: "价格变化",
      pattern: /涨价|降价|套餐|补货|上新|\bpricing\b|\bprice\b/,
    },
  ].find((entry) => entry.pattern.test(text));
  if (!entity || !event) return null;
  return {
    key: `${entity.key}:${event.key}`,
    entity: entity.label,
    event: event.label,
  };
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
]);

const titleTokens = (title: string) => {
  const chunks =
    title.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
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

const sameStory = (left: RankedItem, right: RankedItem) => {
  if (normalizeUrl(left.item.url) === normalizeUrl(right.item.url)) return true;
  const leftSignature = storySignature(left.item.title);
  const rightSignature = storySignature(right.item.title);
  if (leftSignature && leftSignature.key === rightSignature?.key) return true;
  return jaccard(titleTokens(left.item.title), titleTokens(right.item.title)) >= 0.64;
};

const clusterItems = (items: RankedItem[]) => {
  const clusters: TopicCluster[] = [];
  for (const item of items.sort((left, right) => right.score - left.score)) {
    const cluster = clusters.find((candidate) =>
      sameStory(candidate.representative, item),
    );
    if (cluster) {
      cluster.items.push(item);
    } else {
      clusters.push({
        representative: item,
        items: [item],
        score: item.score,
        momentum: 0,
      });
    }
  }

  for (const cluster of clusters) {
    const platforms = new Set(cluster.items.map((entry) => entry.item.platform));
    const sources = new Set(cluster.items.map((entry) => entry.item.sourceId));
    const latestFreshness = Math.max(
      ...cluster.items.map((entry) => entry.freshness),
    );
    const averageEngagement =
      cluster.items.reduce((sum, entry) => sum + entry.engagement, 0) /
      cluster.items.length;
    const evidence = clamp(
      (platforms.size - 1) * 34 +
        (sources.size - 1) * 18 +
        (cluster.items.length - 1) * 10,
    );
    const crossSourceBonus = Math.min(
      18,
      (platforms.size - 1) * 8 +
        (sources.size - 1) * 4 +
        (cluster.items.length - 1) * 2,
    );
    cluster.score =
      Math.round(clamp(cluster.representative.score + crossSourceBonus));
    cluster.momentum =
      Math.round(
        clamp(
          latestFreshness * 0.42 +
            averageEngagement * 0.28 +
            evidence * 0.3,
        ) * 10,
      ) / 10;
  }
  return clusters.sort((left, right) => right.score - left.score);
};

const hashId = (value: string) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
};

const excerpt = (value: string, maximum = 220) => {
  const text = value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>`~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maximum
    ? text
    : `${text.slice(0, maximum - 1).trim()}…`;
};

const clusterTitle = (cluster: TopicCluster) => {
  const signature = storySignature(cluster.representative.item.title);
  if (cluster.items.length > 1 && signature) {
    return `${signature.entity} ${signature.event}出现多条独立信号`;
  }
  return cluster.representative.item.title;
};

const clusterToTopic = (cluster: TopicCluster): Topic => {
  const ordered = [...cluster.items].sort(
    (left, right) => right.score - left.score,
  );
  const platforms = [
    ...new Set(ordered.map((entry) => entry.item.platform)),
  ];
  const latest = [...ordered].sort(
    (left, right) =>
      Date.parse(right.item.publishedAt) - Date.parse(left.item.publishedAt),
  )[0];
  const summarySource =
    cluster.representative.item.aiSummary ||
    cluster.representative.item.body ||
    cluster.representative.item.title;
  const evidenceSuffix =
    ordered.length > 1
      ? ` 已聚合 ${ordered.length} 条内容、${platforms.length} 个平台的交叉信号。`
      : "";
  const tags = [
    ...ordered.flatMap((entry) => entry.topics),
    ...ordered.flatMap((entry) => entry.item.tags),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, values) => values.indexOf(tag) === index)
    .slice(0, 6);
  return {
    id: `topic-${hashId(
      storySignature(cluster.representative.item.title)?.key ||
        cluster.representative.item.id,
    )}`,
    title: excerpt(clusterTitle(cluster), 120),
    summary: excerpt(`${summarySource}${evidenceSuffix}`, 260),
    hotScore: cluster.score,
    momentum: cluster.momentum,
    platforms,
    itemCount: ordered.length,
    updatedAt: latest.item.publishedAt,
    tags,
  };
};

const balancedTopics = (clusters: TopicCluster[], limit: number) => {
  const selected: TopicCluster[] = [];
  const platformCounts = new Map<Platform, number>();
  for (const cluster of clusters) {
    if (selected.length >= limit) break;
    const platform = cluster.representative.item.platform;
    if ((platformCounts.get(platform) ?? 0) >= 6) continue;
    selected.push(cluster);
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
  }
  if (selected.length < limit) {
    for (const cluster of clusters) {
      if (selected.length >= limit) break;
      if (!selected.includes(cluster)) selected.push(cluster);
    }
  }
  return selected;
};

export async function getLiveTopics(options?: {
  hours?: number;
  limit?: number;
  now?: Date;
}): Promise<Topic[]> {
  const now = options?.now ?? new Date();
  const hours = Math.min(168, Math.max(6, options?.hours ?? DEFAULT_WINDOW_HOURS));
  const limit = Math.min(30, Math.max(1, options?.limit ?? 12));
  const items = await listContentsByPeriod(
    new Date(now.getTime() - hours * HOUR_MS).toISOString(),
    new Date(now.getTime() + 5 * 60_000).toISOString(),
    2_000,
  );
  const ranked = items
    .map((item) => scoreItem(item, now.getTime()))
    .filter(
      (entry) =>
        entry.item.hotScore >= 38 &&
        entry.score >= 32 &&
        (entry.topics.length > 0 || entry.item.platform === "gitlab"),
    );
  return balancedTopics(clusterItems(ranked), limit).map(clusterToTopic);
}

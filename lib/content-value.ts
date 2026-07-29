import { engagementTotal } from "./hot-score";
import type {
  ContentItem,
  ContentMetrics,
  NormalizedContentInput,
  Platform,
} from "./types";

interface ContentValueInput {
  platform: Platform;
  title: string;
  body: string;
  url: string;
  authorName: string;
  publishedAt: string;
  metrics: ContentMetrics;
}

const topicGroups = [
  {
    label: "AI",
    terms: [
      "ai",
      "artificial intelligence",
      "人工智能",
      "生成式",
      "inteligencia artificial",
      "intelligence artificielle",
      "künstliche intelligenz",
      "искусственный интеллект",
      "인공지능",
      "人工知能",
    ],
  },
  {
    label: "大模型",
    terms: [
      "llm",
      "large language model",
      "大模型",
      "语言模型",
      "language model",
      "foundation model",
      "multimodal",
      "多模态",
    ],
  },
  {
    label: "模型产品",
    terms: [
      "openai",
      "chatgpt",
      "gpt-",
      "claude",
      "anthropic",
      "gemini",
      "deepseek",
      "qwen",
      "kimi",
      "grok",
      "llama",
      "mistral",
    ],
  },
  {
    label: "Agent/Codex",
    terms: [
      "codex",
      "agent",
      "agentic",
      "mcp",
      "cursor",
      "claude code",
      "coding agent",
      "智能体",
      "代理编程",
    ],
  },
  {
    label: "算力/VPS",
    terms: [
      "vps",
      "gpu",
      "cuda",
      "inference",
      "推理",
      "算力",
      "server",
      "服务器",
      "cloud",
      "云服务",
    ],
  },
  {
    label: "支付/开卡",
    terms: [
      "usdt",
      "crypto",
      "u币",
      "虚拟卡",
      "开卡",
      "银行卡",
      "credit card",
      "virtual card",
      "payment",
      "订阅支付",
    ],
  },
];

const newsTerms = [
  "launch",
  "launched",
  "release",
  "released",
  "introducing",
  "announce",
  "announced",
  "update",
  "new model",
  "open source",
  "benchmark",
  "research",
  "paper",
  "security",
  "vulnerability",
  "acquisition",
  "funding",
  "发布",
  "推出",
  "上线",
  "更新",
  "开源",
  "研究",
  "论文",
  "评测",
  "融资",
  "收购",
  "安全",
  "漏洞",
  "正式版",
  "新模型",
  "nuevo",
  "lanzamiento",
  "nouveau",
  "neues",
  "リリース",
  "発表",
  "출시",
];

const isUnknownAuthor = (name: string) =>
  !name || name === "未知作者" || name === "Unknown author";

const containsTerm = (text: string, term: string) => {
  const normalizedTerm = term.toLowerCase();
  if (/^[a-z0-9+-]{1,3}$/.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(text);
  }
  return text.includes(normalizedTerm);
};

export function matchedValueTopics(
  item: Pick<ContentValueInput, "title" | "body">,
): string[] {
  const text = `${item.title} ${item.body}`.toLowerCase();
  return topicGroups
    .filter((group) => group.terms.some((term) => containsTerm(text, term)))
    .map((group) => group.label);
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const finite = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

export function calculateContentValueScore(input: ContentValueInput): number {
  const now = Date.now();
  const published = new Date(input.publishedAt).getTime();
  const ageHours = Number.isFinite(published)
    ? Math.max(0, (now - published) / 3_600_000)
    : 72;
  const topicCount = matchedValueTopics(input).length;
  const relevanceScore =
    topicCount === 0 ? 0 : topicCount === 1 ? 68 : topicCount === 2 ? 86 : 100;
  const freshnessScore = 100 * Math.exp(-ageHours / 48);

  const engagement = engagementTotal(input.metrics);
  const views = finite(input.metrics.views);
  const reachScore = clamp((Math.log10(views + 1) / 6) * 100);
  const interactionScore = clamp((Math.log10(engagement + 1) / 4.5) * 100);
  const rateScore = clamp((engagement / Math.max(views, 100)) * 2_000);
  const engagementScore =
    reachScore * 0.45 + interactionScore * 0.35 + rateScore * 0.2;

  const followers = finite(input.metrics.authorFollowers);
  const authorityScore = followers
    ? clamp((Math.log10(followers + 1) / 6) * 100)
    : isUnknownAuthor(input.authorName)
      ? 0
      : 25;

  const hasMetrics = views > 0 || engagement > 0;
  const completenessScore =
    (input.title.length >= 18 ? 22 : 10) +
    (input.body.length >= 80 ? 28 : input.body.length >= 20 ? 16 : 0) +
    (isUnknownAuthor(input.authorName) ? 0 : 25) +
    (hasMetrics ? 15 : 0) +
    (/^https?:\/\//.test(input.url) ? 10 : 0);

  const text = `${input.title} ${input.body}`.toLowerCase();
  const newsMatches = newsTerms.filter((term) => text.includes(term)).length;
  const newsworthinessScore = clamp(newsMatches * 38);
  const cryptoPromotion =
    /\bmarket cap\b|\bmy next call\b|\bholders?\b|\bairdrop\b|空投/.test(
      text,
    ) &&
    /0x[a-f0-9]{20,}|\$[a-z]{2,10}\b|\btoken\b/.test(text);
  const solicitation =
    /\buse my (?:code|link)\b|\breferral\b|\bdm me\b|\bgiveaway\b|抽奖|返佣/.test(
      text,
    );
  const engagementBait =
    /\bretweet to\b|\brepost to\b|\bfollow me\b|转发并关注/.test(text);
  const qualityPenalty =
    (cryptoPromotion ? 38 : 0) +
    (solicitation ? 20 : 0) +
    (engagementBait ? 12 : 0) +
    (input.title.length < 12 && input.body.length < 30 ? 18 : 0);
  const officialSourceBonus = input.platform === "gitlab" ? 18 : 0;

  return Math.round(
    clamp(
      5 +
        relevanceScore * 0.27 +
        freshnessScore * 0.22 +
        engagementScore * 0.2 +
        authorityScore * 0.1 +
        completenessScore * 0.09 +
        newsworthinessScore * 0.12 -
        qualityPenalty +
        officialSourceBonus,
    ),
  );
}

export function recommendationScore(
  item: Pick<ContentItem, "hotScore" | "publishedAt">,
): number {
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000,
  );
  const recencyBoost = Math.max(0, 15 * Math.exp(-ageHours / 30));
  return item.hotScore + recencyBoost;
}

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}K`
      : String(Math.round(value));

export function getValueReasons(
  item: ContentItem | NormalizedContentInput,
): string[] {
  const reasons: string[] = [];
  if (item.platform === "gitlab") reasons.push("GitLab 官方源");
  const topics = matchedValueTopics(item);
  if (topics.length) reasons.push(`命中 ${topics.slice(0, 2).join("、")}`);

  const ageHours =
    (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000;
  if (ageHours <= 6) reasons.push("6 小时内发布");
  else if (ageHours <= 24) reasons.push("24 小时内发布");

  const engagement = engagementTotal(item.metrics);
  if (finite(item.metrics.views) >= 10_000) {
    reasons.push(`${compact(finite(item.metrics.views))} 浏览`);
  } else if (engagement >= 50) {
    reasons.push(`${compact(engagement)} 加权互动`);
  }
  if (
    reasons.length < 3 &&
    finite(item.metrics.authorFollowers) >= 10_000
  ) {
    reasons.push("高影响力作者");
  }
  if (reasons.length < 3 && !isUnknownAuthor(item.authorName)) {
    reasons.push("作者信息明确");
  }
  if (!reasons.length) reasons.push("新内容观察");
  return reasons.slice(0, 3);
}

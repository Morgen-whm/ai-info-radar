import type { AppEnv } from "@/db/runtime";
import {
  getGitHubStarSnapshotMap,
  saveGitHubStarSnapshots,
} from "@/db/repository";
import type {
  ConnectorResult,
  NormalizedContentInput,
  Source,
} from "@/lib/types";

interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  license?: { spdx_id?: string; name?: string } | null;
}

interface GrowthEntry {
  repository: GitHubRepository;
  period: "daily" | "weekly";
  periodStart: string;
  periodEnd: string;
  startStars: number;
  endStars: number;
  growth: number;
  growthRate: number;
  explosive: boolean;
}

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;

const shanghaiDate = (now: Date) =>
  new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

const isMonday = (date: string) =>
  new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

const compactNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1, notation: "compact" })
    .format(value)
    .replace("万", " 万");

const percentage = (value: number) =>
  `${Math.round(value * 10_000) / 100}%`;

const buildQueries = (today: string) => {
  const recent = shiftDate(today, -14);
  const newProjectWindow = shiftDate(today, -30);
  return [
    "topic:artificial-intelligence archived:false fork:false stars:>20",
    "topic:llm archived:false fork:false stars:>20",
    "topic:generative-ai archived:false fork:false stars:>20",
    "topic:ai-agent archived:false fork:false stars:>10",
    "topic:mcp archived:false fork:false stars:>5",
    `AI in:name,description created:>=${newProjectWindow} archived:false fork:false stars:>5`,
    `AI in:name,description pushed:>=${recent} archived:false fork:false stars:20..10000`,
  ];
};

async function searchRepositories(
  query: string,
  env: AppEnv,
  sort: "stars" | "updated" | "relevance",
  limit = 100,
): Promise<GitHubRepository[]> {
  const baseUrl = (env.GITHUB_API_BASE_URL || "https://api.github.com").replace(
    /\/$/,
    "",
  );
  const url = new URL(`${baseUrl}/search/repositories`);
  url.searchParams.set("q", query);
  if (sort !== "relevance") url.searchParams.set("sort", sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(limit));
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TrendHub-AI-Radar/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      throw new Error(
        `GitHub Search HTTP ${response.status}${remaining === "0" ? "，搜索额度已用完，请配置 GITHUB_TOKEN" : ""}`,
      );
    }
    const payload = (await response.json()) as { items?: GitHubRepository[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchGitHubTopic(
  query: string,
  env: AppEnv,
  options: { latest: boolean; since: string; limit: number },
): Promise<ConnectorResult> {
  const repositories = await searchRepositories(
    `${query} pushed:>=${options.since.slice(0, 10)}`,
    env, options.latest ? "updated" : "relevance", options.limit,
  );
  const now = new Date().toISOString();
  return {
    billable: false,
    items: repositories.filter((repo) => repo.id && repo.full_name && repo.owner).map((repo) => ({
      externalId: `github-repository-${repo.id}`, platform: "github", type: "repository",
      title: repo.full_name,
      body: [repo.description || "仓库暂未填写简介。",
        `语言：${repo.language || "未标注"}；许可证：${repo.license?.spdx_id || "未标注"}。`,
        `最近推送：${repo.pushed_at || repo.updated_at}。${repo.archived ? "该仓库已归档。" : ""}`].join("\n"),
      url: repo.html_url, authorName: repo.owner.login, authorHandle: `@${repo.owner.login}`,
      authorAvatarUrl: repo.owner.avatar_url, publishedAt: repo.created_at, fetchedAt: now,
      metrics: { stars: repo.stargazers_count, forks: repo.forks_count, openIssues: repo.open_issues_count },
      tags: ["GitHub", ...(repo.topics || []).slice(0, 8)], raw: { repository: repo },
    })),
  };
}

function isAiRepository(repository: GitHubRepository): boolean {
  const text = [
    repository.name,
    repository.description || "",
    ...(repository.topics || []),
  ]
    .join(" ")
    .toLowerCase();
  return /\bai\b|artificial intelligence|\bllm\b|large language model|generative|agentic|ai[- ]?agent|machine learning|deep learning|\bmcp\b|rag\b|transformer|diffusion|codex/.test(
    text,
  );
}

function rankGrowth(
  repositories: GitHubRepository[],
  startSnapshot: Map<string, number>,
  period: "daily" | "weekly",
  periodStart: string,
  periodEnd: string,
): GrowthEntry[] {
  return repositories
    .map((repository): GrowthEntry | null => {
      const repositoryId = String(repository.id);
      const createdDate = repository.created_at.slice(0, 10);
      const knownStart = startSnapshot.get(repositoryId);
      const createdInsidePeriod =
        createdDate >= periodStart && createdDate < periodEnd;
      if (knownStart === undefined && !createdInsidePeriod) return null;
      const startStars = knownStart ?? 0;
      const endStars = Math.max(0, repository.stargazers_count);
      const growth = Math.max(0, endStars - startStars);
      if (!growth) return null;
      const growthRate = growth / Math.max(1, startStars);
      const explosive =
        period === "daily"
          ? growth >= 200 || growth >= 50 && growthRate >= 0.2
          : growth >= 800 || growth >= 150 && growthRate >= 0.35;
      return {
        repository,
        period,
        periodStart,
        periodEnd,
        startStars,
        endStars,
        growth,
        growthRate,
        explosive,
      };
    })
    .filter((entry): entry is GrowthEntry => Boolean(entry))
    .sort(
      (left, right) =>
        Number(right.explosive) - Number(left.explosive) ||
        right.growth - left.growth ||
        right.growthRate - left.growthRate,
    )
    .slice(0, 10);
}

function growthItem(
  entry: GrowthEntry,
  rank: number,
  fetchedAt: string,
): NormalizedContentInput {
  const repository = entry.repository;
  const periodLabel = entry.period === "daily" ? "昨日" : "上周";
  const rankingLabel = entry.period === "daily" ? "GitHub 日增榜" : "GitHub 周增榜";
  const language = repository.language || "语言未标注";
  const license = repository.license?.spdx_id || "许可证待核对";
  const explosiveLabel = entry.explosive ? "爆发增长；" : "";
  return {
    externalId: `github-growth-${entry.period}-${entry.periodStart}-${repository.id}`,
    platform: "github",
    type: "repository",
    title: `${entry.explosive ? "爆发项目 · " : ""}${repository.full_name} ${periodLabel}新增 ${entry.growth.toLocaleString("zh-CN")} Star`,
    body: [
      repository.description || "仓库暂未填写项目简介。",
      `${explosiveLabel}${periodLabel} Star 从 ${entry.startStars.toLocaleString("zh-CN")} 增至 ${entry.endStars.toLocaleString("zh-CN")}，净增 ${entry.growth.toLocaleString("zh-CN")}，增幅 ${percentage(entry.growthRate)}。`,
      `主要语言：${language}；Fork：${repository.forks_count.toLocaleString("zh-CN")}；Open Issues：${repository.open_issues_count.toLocaleString("zh-CN")}；许可证：${license}。`,
      `统计窗口：${entry.periodStart} 至 ${entry.periodEnd}（Asia/Shanghai），名次：${rankingLabel}第 ${rank}。`,
    ].join("\n"),
    url: repository.html_url,
    authorName: repository.owner.login,
    authorHandle: `@${repository.owner.login}`,
    authorAvatarUrl: repository.owner.avatar_url,
    publishedAt: fetchedAt,
    fetchedAt,
    metrics: {
      stars: entry.endStars,
      forks: repository.forks_count,
      openIssues: repository.open_issues_count,
      starGrowth24h: entry.period === "daily" ? entry.growth : undefined,
      starGrowth7d: entry.period === "weekly" ? entry.growth : undefined,
      starGrowthRate: entry.growthRate,
    },
    tags: [
      "GitHub",
      rankingLabel,
      ...(entry.explosive ? ["爆发增长"] : []),
      ...(repository.language ? [repository.language] : []),
      ...(repository.topics || []).slice(0, 6),
    ].slice(0, 10),
    raw: {
      repository,
      ranking: {
        rank,
        period: entry.period,
        periodStart: entry.periodStart,
        periodEnd: entry.periodEnd,
        startStars: entry.startStars,
        endStars: entry.endStars,
        growth: entry.growth,
        growthRate: entry.growthRate,
        explosive: entry.explosive,
      },
    },
  };
}

export function isValidGitHubTarget(target: string): boolean {
  return target === "github://ai-star-growth";
}

export async function fetchGitHubSource(
  source: Source,
  env: AppEnv,
): Promise<ConnectorResult> {
  if (!isValidGitHubTarget(source.target)) {
    throw new Error("GitHub 增长榜数据源目标必须为 github://ai-star-growth");
  }
  const now = new Date();
  const fetchedAt = now.toISOString();
  const today = shanghaiDate(now);
  const repositories = new Map<string, GitHubRepository>();
  const discoveryPriorityIds = new Set<string>();
  const queries = buildQueries(today);
  for (let index = 0; index < queries.length; index += 1) {
    const items = await searchRepositories(
      queries[index],
      env,
      index === queries.length - 1 ? "updated" : "stars",
    );
    for (const repository of items) {
      if (
        !repository.archived &&
        !repository.fork &&
        isAiRepository(repository)
      ) {
        repositories.set(String(repository.id), repository);
        if (index >= queries.length - 2) {
          discoveryPriorityIds.add(String(repository.id));
        }
      }
    }
  }
  const allRepositories = [...repositories.values()];
  const discoveryCandidates = allRepositories
    .filter((repository) => discoveryPriorityIds.has(String(repository.id)))
    .sort(
      (left, right) =>
        Date.parse(right.created_at) - Date.parse(left.created_at) ||
        right.stargazers_count - left.stargazers_count,
    )
    .slice(0, 180);
  const establishedCandidates = allRepositories
    .filter((repository) => !discoveryPriorityIds.has(String(repository.id)))
    .sort((left, right) => right.stargazers_count - left.stargazers_count)
    .slice(0, 500 - discoveryCandidates.length);
  const candidates = [...discoveryCandidates, ...establishedCandidates];
  const repositoryIds = candidates.map((repository) => String(repository.id));
  const dailyStart = shiftDate(today, -1);
  const weeklyStart = shiftDate(today, -7);
  const [dailyStartStars, weeklyStartStars] = await Promise.all([
    getGitHubStarSnapshotMap(repositoryIds, dailyStart),
    isMonday(today)
      ? getGitHubStarSnapshotMap(repositoryIds, weeklyStart)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const daily = rankGrowth(
    candidates,
    dailyStartStars,
    "daily",
    dailyStart,
    today,
  );
  const weekly = isMonday(today)
    ? rankGrowth(
        candidates,
        weeklyStartStars,
        "weekly",
        weeklyStart,
        today,
      )
    : [];

  await saveGitHubStarSnapshots(
    candidates.map((repository) => ({
      repositoryId: String(repository.id),
      fullName: repository.full_name,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      capturedDate: today,
      capturedAt: fetchedAt,
      repository,
    })),
  );

  return {
    items: [
      ...daily.map((entry, index) => growthItem(entry, index + 1, fetchedAt)),
      ...weekly.map((entry, index) => growthItem(entry, index + 1, fetchedAt)),
    ],
    requestId: `github-${today}-${repositories.size}`,
    billable: false,
  };
}

export const githubGrowthInternals = {
  rankGrowth,
  shiftDate,
  shanghaiDate,
  isMonday,
  compactNumber,
};

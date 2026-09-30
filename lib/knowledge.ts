import type { ContentItem, KnowledgeCategory } from "./types";

export const knowledgeCategories: Array<{
  id: KnowledgeCategory;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "codex_skills",
    label: "Codex 技能与技巧",
    shortLabel: "Codex",
    description: "任务规划、上下文管理、Skills、MCP 与稳定工作流。",
  },
  {
    id: "open_source",
    label: "刚出现的开源项目",
    shortLabel: "开源项目",
    description: "说明项目解决什么问题、适合谁，以及真实使用成本。",
  },
  {
    id: "overseas_practice",
    label: "海外社区新玩法",
    shortLabel: "海外实践",
    description: "捕捉国内尚未广泛传播的新工具、插件和组合方法。",
  },
  {
    id: "tested_tutorial",
    label: "经过实测的教程",
    shortLabel: "实测教程",
    description: "覆盖安装、配置、验证、边界和常见故障排查。",
  },
];

export function isKnowledgeCategory(
  value: unknown,
): value is KnowledgeCategory {
  return knowledgeCategories.some((category) => category.id === value);
}

export function getKnowledgeCategory(category: KnowledgeCategory) {
  return (
    knowledgeCategories.find((item) => item.id === category) ||
    knowledgeCategories[2]
  );
}

export function inferKnowledgeCategory(
  item: Pick<
    ContentItem,
    "title" | "body" | "tags" | "platform" | "sourceId"
  >,
): KnowledgeCategory {
  if (item.sourceId === "src-x-codex-skills") return "codex_skills";
  if (item.sourceId === "src-x-open-source-projects") return "open_source";
  if (item.sourceId === "src-x-overseas-practice") return "overseas_practice";
  if (item.sourceId === "src-yt-tested-tutorials") return "tested_tutorial";
  const text = `${item.title} ${item.body} ${item.tags.join(" ")}`.toLowerCase();
  if (/codex|skill|mcp|agent workflow|上下文|提示词|prompt/.test(text)) {
    return "codex_skills";
  }
  if (
    item.platform === "gitlab" ||
    item.platform === "github" ||
    /github|gitlab|open[ -]?source|开源|repository|repo\b|release/.test(text)
  ) {
    return "open_source";
  }
  if (
    /tutorial|how to|walkthrough|setup|install|配置|安装|教程|实测|踩坑|排障|部署/.test(
      text,
    )
  ) {
    return "tested_tutorial";
  }
  return "overseas_practice";
}

export function knowledgeExcerpt(markdown: string, maxLength = 168): string {
  const clean = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*>\d.)\s]+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

export function createKnowledgeSlug(
  title: string,
  contentId: string,
  category: KnowledgeCategory,
): string {
  const readable = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54);
  const suffix = contentId.replace(/[^a-z0-9]/gi, "").slice(-10).toLowerCase();
  return `${readable || category}-${suffix || crypto.randomUUID().slice(0, 8)}`;
}

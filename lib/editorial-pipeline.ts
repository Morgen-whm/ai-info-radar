import type { AppEnv } from "@/db/runtime";
import {
  getKnowledgeBaseWritingPrompt,
  knowledgeBaseWritingProfile,
} from "@/lib/editorial-profiles";
import { getKnowledgeCategory } from "@/lib/knowledge";
import type {
  ContentItem,
  EditorialEvidenceClaim,
  EditorialEvidencePack,
  EditorialFactCheckIssue,
  EditorialFactCheckReport,
  EditorialFormatCheckReport,
  EditorialMediaAsset,
  EditorialPipeline,
  EditorialSourceBundle,
  EditorialTemplate,
  EditorialWritingAngle,
  KnowledgeCategory,
  RelatedEditorialMaterial,
} from "@/lib/types";

type Generated<T> = {
  value: T;
  generatedBy: "ai" | "local";
  errorMessage?: string;
};

interface EditorialDraft {
  title: string;
  content: string;
  generatedBy: "ai" | "local";
  errorMessage?: string;
}

interface CheckedDraft extends EditorialDraft {
  factCheck: EditorialFactCheckReport;
}

type EditorialVisual = Pick<
  EditorialMediaAsset,
  "id" | "kind" | "alt" | "sourceUrl"
> & { url: string };

const safeVisualUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export function getUsableEditorialVisuals(
  sourceBundle?: EditorialSourceBundle | null,
): EditorialVisual[] {
  const visuals = new Map<string, EditorialVisual>();
  for (const media of sourceBundle?.media ?? []) {
    const candidate = media.kind === "video" ? media.previewUrl : media.url;
    const url = safeVisualUrl(candidate);
    if (!url || visuals.has(url)) continue;
    visuals.set(url, {
      id: media.id,
      kind: media.kind,
      url,
      alt: cleanText(media.alt || "内容相关画面", 160),
      sourceUrl: media.sourceUrl,
    });
  }
  return [...visuals.values()].slice(0, 4);
}

const markdownImageUrls = (content: string) =>
  [...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].map(
    (match) => match[1],
  );

function insertPrimaryEditorialVisual(
  content: string,
  visual: EditorialVisual,
  title = "",
): string {
  const alt = cleanText(
    visual.alt && visual.alt !== "内容相关画面"
      ? visual.alt
      : `${title || "正文"}相关画面`,
    120,
  ).replace(/[\[\]]/g, "");
  const image = `![${alt}](${visual.url})`;
  const lines = content.split("\n");
  let paragraphStart = lines.findIndex((line) => {
    const value = line.trim();
    return Boolean(
      value &&
        !/^(#{1,6}\s|>|[-*+]\s|\d+\.\s|```|!\[)/.test(value),
    );
  });
  if (paragraphStart < 0) paragraphStart = 0;
  let insertAt = paragraphStart;
  while (insertAt + 1 < lines.length && lines[insertAt + 1].trim()) {
    insertAt += 1;
  }
  lines.splice(insertAt + 1, 0, "", image);
  return lines.join("\n");
}

const stopWords = new Set([
  "about",
  "after",
  "from",
  "into",
  "that",
  "the",
  "this",
  "with",
  "发布",
  "更新",
  "最新",
  "一个",
  "这个",
  "什么",
  "如何",
]);

const cleanText = (value: unknown, max = 20_000) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const stringArray = (value: unknown, limit = 12) =>
  Array.isArray(value)
    ? value.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, limit)
    : [];

const tokens = (value: string): Set<string> => {
  const parts =
    value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set<string>();
  for (const part of parts) {
    if (/^[\p{Script=Han}]+$/u.test(part)) {
      for (let index = 0; index < part.length - 1; index += 1) {
        const token = part.slice(index, index + 2);
        if (!stopWords.has(token)) result.add(token);
      }
    } else if (part.length > 2 && !stopWords.has(part)) {
      result.add(part);
    }
  }
  return result;
};

const overlap = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.min(left.size, right.size);
};

const firstSentence = (item: ContentItem) => {
  const value = cleanText(item.aiSummary || item.body || item.title, 600);
  const match = value.match(/^(.{24,260}?[。！？.!?])(?:\s|$)/u);
  return cleanText(match?.[1] || value.slice(0, 220), 260);
};

export function createEmptyEditorialPipeline(
  updatedAt = new Date().toISOString(),
): EditorialPipeline {
  return {
    stage: "source",
    writingProfileId: knowledgeBaseWritingProfile.id,
    writingProfileVersion: knowledgeBaseWritingProfile.version,
    sourceBundle: null,
    relatedMaterials: [],
    evidencePack: null,
    writingAngles: [],
    selectedAngleId: "",
    factCheck: null,
    formatCheck: null,
    updatedAt,
  };
}

export function normalizeEditorialPipeline(
  value: Partial<EditorialPipeline> | null | undefined,
  updatedAt: string,
): EditorialPipeline {
  const empty = createEmptyEditorialPipeline(updatedAt);
  return {
    ...empty,
    ...value,
    writingProfileId:
      value?.writingProfileId || knowledgeBaseWritingProfile.id,
    writingProfileVersion:
      value?.writingProfileVersion || knowledgeBaseWritingProfile.version,
    sourceBundle: value?.sourceBundle ?? null,
    relatedMaterials: Array.isArray(value?.relatedMaterials)
      ? value.relatedMaterials
      : [],
    writingAngles: Array.isArray(value?.writingAngles)
      ? value.writingAngles
      : [],
    evidencePack: value?.evidencePack ?? null,
    factCheck: value?.factCheck ?? null,
    formatCheck: value?.formatCheck ?? null,
    updatedAt: value?.updatedAt || updatedAt,
  };
}

export function findRelatedEditorialMaterials(
  primary: ContentItem,
  candidates: ContentItem[],
  limit = 6,
): RelatedEditorialMaterial[] {
  const primaryTitleTokens = tokens(primary.title);
  const primaryBodyTokens = tokens(
    `${primary.title} ${primary.aiSummary || ""} ${primary.body.slice(0, 1_500)}`,
  );
  const primaryTags = new Set(primary.tags.map((tag) => tag.toLowerCase()));
  const primaryTime = Date.parse(primary.publishedAt);

  return candidates
    .filter(
      (item) =>
        item.id !== primary.id &&
        item.url !== primary.url &&
        item.title.trim().toLowerCase() !== primary.title.trim().toLowerCase(),
    )
    .map((item) => {
      const titleTokens = tokens(item.title);
      const bodyTokens = tokens(
        `${item.title} ${item.aiSummary || ""} ${item.body.slice(0, 1_000)}`,
      );
      const titleOverlap = overlap(primaryTitleTokens, titleTokens);
      const contextOverlap = overlap(primaryBodyTokens, bodyTokens);
      const matchedTags = item.tags
        .map((tag) => tag.toLowerCase())
        .filter((tag) => primaryTags.has(tag));
      const matchedTokens = [...primaryTitleTokens]
        .filter((token) => titleTokens.has(token) || bodyTokens.has(token))
        .slice(0, 6);
      const itemTime = Date.parse(item.publishedAt);
      const distanceDays =
        Number.isFinite(primaryTime) && Number.isFinite(itemTime)
          ? Math.abs(primaryTime - itemTime) / 86_400_000
          : 30;
      const freshness = Math.max(0, 1 - distanceDays / 45);
      const crossSource =
        item.sourceId !== primary.sourceId || item.platform !== primary.platform
          ? 1
          : 0;
      const relevanceScore = Math.round(
        Math.min(
          100,
          titleOverlap * 52 +
            contextOverlap * 20 +
            Math.min(3, matchedTags.length) * 8 +
            freshness * 8 +
            crossSource * 6 +
            Math.min(6, item.hotScore / 18),
        ),
      );
      return {
        contentId: item.id,
        platform: item.platform,
        title: item.title,
        url: item.url,
        authorName: item.authorName,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        hotScore: Math.round(item.hotScore * 10) / 10,
        relevanceScore,
        matchedTerms: [...new Set([...matchedTags, ...matchedTokens])].slice(0, 8),
        excerpt: firstSentence(item),
      } satisfies RelatedEditorialMaterial;
    })
    .filter(
      (item) => item.relevanceScore >= 20 && item.matchedTerms.length > 0,
    )
    .sort(
      (left, right) =>
        right.relevanceScore - left.relevanceScore ||
        right.hotScore - left.hotScore,
    )
    .slice(0, Math.min(10, Math.max(1, limit)));
}

async function requestAiJson<T>(
  env: AppEnv,
  system: string,
  input: unknown,
  maxTokens: number,
): Promise<{ value: T | null; errorMessage?: string }> {
  if (!env.AI_API_KEY) {
    return { value: null, errorMessage: "AI_API_KEY未配置" };
  }
  const baseUrl = (env.AI_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    "",
  );
  const model = env.AI_MODEL || "deepseek-v4-pro";
  const isDeepSeek =
    /api\.deepseek\.com/i.test(baseUrl) || /^deepseek-/i.test(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: maxTokens,
        ...(isDeepSeek
          ? {
              thinking: { type: "disabled" },
              response_format: { type: "json_object" },
            }
          : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      let providerMessage = "";
      try {
        const errorPayload = JSON.parse(responseText) as {
          error?: { message?: string } | string;
          message?: string;
        };
        providerMessage =
          typeof errorPayload.error === "string"
            ? errorPayload.error
            : errorPayload.error?.message || errorPayload.message || "";
      } catch {
        providerMessage = responseText.slice(0, 300);
      }
      console.error(
        `AI structured request failed (${response.status}, ${model}):`,
        responseText.slice(0, 800),
      );
      return {
        value: null,
        errorMessage: `DeepSeek请求失败（HTTP ${response.status}）${providerMessage ? `：${providerMessage}` : ""}`,
      };
    }
    const payload = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content
      ?.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    if (!content) {
      return { value: null, errorMessage: "DeepSeek返回内容为空" };
    }
    try {
      return { value: JSON.parse(content) as T };
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return { value: JSON.parse(content.slice(start, end + 1)) as T };
        } catch {
          // Fall through to the safe parse error below.
        }
      }
      console.error(
        `AI structured response was not valid JSON (${model}):`,
        content.slice(0, 800),
      );
      return {
        value: null,
        errorMessage: "DeepSeek返回的JSON不完整或无法解析",
      };
    }
  } catch (error) {
    console.error(
      `AI structured request could not be completed (${model}):`,
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      value: null,
      errorMessage:
        error instanceof Error
          ? `DeepSeek请求异常：${error.message}`
          : "DeepSeek请求异常",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function localEvidencePack(
  primary: ContentItem,
  related: RelatedEditorialMaterial[],
): EditorialEvidencePack {
  const primaryTokens = tokens(`${primary.title} ${firstSentence(primary)}`);
  const claims: EditorialEvidenceClaim[] = [
    {
      id: "claim-primary",
      claim: firstSentence(primary) || primary.title,
      type: "fact",
      support: "single_source",
      sourceIds: [primary.id],
      note: "来自入选原始材料，发布前仍需打开原文核对上下文。",
    },
  ];
  related.slice(0, 6).forEach((material, index) => {
    const corroborates = overlap(
      primaryTokens,
      tokens(`${material.title} ${material.excerpt}`),
    ) >= 0.38;
    claims.push({
      id: `claim-related-${index + 1}`,
      claim: material.excerpt || material.title,
      type: "context",
      support: corroborates ? "cross_source" : "single_source",
      sourceIds: corroborates
        ? [primary.id, material.contentId]
        : [material.contentId],
      note: corroborates ? "与主材料描述同一事件。" : "提供同话题背景。",
    });
  });
  return {
    subject: primary.title,
    summary: `围绕“${primary.title}”整理了 ${1 + related.length} 份材料。证据包只记录来源中明确出现的信息。`,
    claims,
    conflicts: [],
    gaps: [
      "尚未联网核对原始发布方之外的独立权威来源。",
      "原文未明确给出的数字、时间、因果关系和结论不得补写。",
    ],
    sourceCount: 1 + related.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateEditorialEvidencePack(
  primary: ContentItem,
  related: RelatedEditorialMaterial[],
  env: AppEnv,
  options: {
    sourceBundle?: EditorialSourceBundle | null;
    relatedContents?: ContentItem[];
  } = {},
): Promise<Generated<EditorialEvidencePack>> {
  const fallback = localEvidencePack(primary, related);
  const sourceIdList = [
    primary.id,
    ...related.map((item) => item.contentId),
  ];
  const sourceIds = new Set(sourceIdList);
  const sourceAliases = new Map(
    sourceIdList.map((sourceId, index) => [sourceId, `S${index + 1}`]),
  );
  const aliasToSourceId = new Map(
    [...sourceAliases.entries()].map(([sourceId, alias]) => [alias, sourceId]),
  );
  const relatedContentMap = new Map(
    (options.relatedContents ?? []).map((item) => [item.id, item]),
  );
  const aiResponse = await requestAiJson<Partial<EditorialEvidencePack>>(
    env,
    [
      getKnowledgeBaseWritingPrompt("evidence"),
      `你是事实证据编辑。只允许使用给出的材料，把明确事实、背景和作者观点分开。每条声明的sourceIds只能从${[...aliasToSourceId.keys()].join("、")}中原样选择，不得生成其他ID。相互矛盾或无法证明的内容不得合并。字幕、串文和简介中没有出现的事实不得补写。输出严格JSON：subject, summary, claims, conflicts, gaps。claims每项为id, claim, type(fact/context/opinion), support(cross_source/single_source/unverified/conflict), sourceIds, note。`,
    ].join("\n\n"),
    {
      primary: {
        sourceId: sourceAliases.get(primary.id),
        title: primary.title,
        body: (options.sourceBundle?.fullText || primary.body).slice(0, 70_000),
        summary: primary.aiSummary,
        author: primary.authorName,
        publishedAt: primary.publishedAt,
        url: primary.url,
        platform: primary.platform,
        transcriptLanguage: options.sourceBundle?.transcriptLanguage,
        sourceWarnings: options.sourceBundle?.warnings,
      },
      related: related.map((item) => {
        const full = relatedContentMap.get(item.contentId);
        return {
          sourceId: sourceAliases.get(item.contentId),
          title: item.title,
          body: (full?.body || full?.aiSummary || item.excerpt).slice(0, 10_000),
          author: item.authorName,
          publishedAt: item.publishedAt,
          url: item.url,
        };
      }),
    },
    2_800,
  );
  const result = aiResponse.value;
  const rawClaims = Array.isArray(result?.claims) ? result.claims : [];
  const claims = rawClaims
    .map((claim, index) => {
      const candidate = claim as Partial<EditorialEvidenceClaim>;
      const ids = stringArray(candidate.sourceIds, 8)
        .map((id) => {
          const normalized = id.trim().toUpperCase();
          return aliasToSourceId.get(normalized) ||
            (sourceIds.has(id) ? id : "");
        })
        .filter(Boolean);
      const type = ["fact", "context", "opinion"].includes(
        String(candidate.type),
      )
        ? candidate.type!
        : "context";
      const support = [
        "cross_source",
        "single_source",
        "unverified",
        "conflict",
      ].includes(String(candidate.support))
        ? candidate.support!
        : ids.length > 1
          ? "cross_source"
          : "single_source";
      return {
        id: cleanText(candidate.id, 80) || `claim-${index + 1}`,
        claim: cleanText(candidate.claim, 700),
        type,
        support,
        sourceIds: [...new Set(ids)],
        note: cleanText(candidate.note, 500) || undefined,
      } satisfies EditorialEvidenceClaim;
    })
    .filter((claim) => claim.claim && claim.sourceIds.length)
    .slice(0, 16);
  if (!result || !claims.length) {
    return {
      value: fallback,
      generatedBy: "local",
      errorMessage:
        aiResponse.errorMessage ||
        "DeepSeek返回了JSON，但没有包含可绑定来源ID的事实声明",
    };
  }
  return {
    generatedBy: "ai",
    value: {
      subject: cleanText(result.subject, 300) || primary.title,
      summary: cleanText(result.summary, 1_200) || fallback.summary,
      claims,
      conflicts: stringArray(result.conflicts, 10),
      gaps: stringArray(result.gaps, 10),
      sourceCount: sourceIds.size,
      generatedAt: new Date().toISOString(),
    },
  };
}

function localAngles(
  primary: ContentItem,
  evidence: EditorialEvidencePack,
): EditorialWritingAngle[] {
  const claimIds = evidence.claims.slice(0, 6).map((claim) => claim.id);
  return [
    {
      id: "angle-change",
      title: "变化与影响",
      thesis: `从“发生了什么”推进到“${primary.title} 会改变谁的判断”。`,
      readerValue: "快速判断这条信息是否值得跟进，以及影响从哪里开始。",
      outline: ["一句话结论", "已确认变化", "影响对象", "仍待核实的问题"],
      novelty: "不复述消息本身，强调变化前后和决策含义。",
      evidenceClaimIds: claimIds,
      risks: evidence.gaps.slice(0, 2),
      recommended: true,
    },
    {
      id: "angle-decision",
      title: "决策清单",
      thesis: "把分散信息整理成采用、观望或避坑的判断框架。",
      readerValue: "让学习者和开发者知道下一步该验证什么。",
      outline: ["适合谁", "核心收益", "验证步骤", "成本与风险"],
      novelty: "用行动门槛组织内容，而不是按原文顺序复述。",
      evidenceClaimIds: claimIds,
      risks: evidence.gaps.slice(0, 2),
      recommended: false,
    },
    {
      id: "angle-evidence",
      title: "证据拆解",
      thesis: "区分已证实事实、单一来源说法和编辑判断。",
      readerValue: "帮助读者在热点噪音中识别可信部分。",
      outline: ["证据结论", "多源印证", "单源线索", "争议与缺口"],
      novelty: "公开证据边界，保留不确定性。",
      evidenceClaimIds: claimIds,
      risks: evidence.conflicts.slice(0, 2),
      recommended: false,
    },
  ];
}

export async function generateEditorialWritingAngles(
  primary: ContentItem,
  evidence: EditorialEvidencePack,
  env: AppEnv,
): Promise<Generated<EditorialWritingAngle[]>> {
  const fallback = localAngles(primary, evidence);
  const claimIds = new Set(evidence.claims.map((claim) => claim.id));
  const aiResponse = await requestAiJson<{ angles?: unknown[] }>(
    env,
    [
      getKnowledgeBaseWritingPrompt("angles"),
      "你是中文知识产品的选题编辑。基于证据包提出3个明显不同、可由现有证据支撑的写作角度，不虚构体验、案例或结论。避免空泛的全面解读。输出严格JSON，只有angles；每项含id,title,thesis,readerValue,outline,novelty,evidenceClaimIds,risks,recommended，且只能有一个recommended=true。",
    ].join("\n\n"),
    { title: primary.title, evidence },
    1_800,
  );
  const result = aiResponse.value;
  const angles = (Array.isArray(result?.angles) ? result.angles : [])
    .map((entry, index) => {
      const angle = entry as Partial<EditorialWritingAngle>;
      return {
        id: cleanText(angle.id, 80) || `angle-${index + 1}`,
        title: cleanText(angle.title, 120),
        thesis: cleanText(angle.thesis, 500),
        readerValue: cleanText(angle.readerValue, 500),
        outline: stringArray(angle.outline, 8),
        novelty: cleanText(angle.novelty, 500),
        evidenceClaimIds: stringArray(angle.evidenceClaimIds, 12).filter((id) =>
          claimIds.has(id),
        ),
        risks: stringArray(angle.risks, 6),
        recommended: Boolean(angle.recommended),
      } satisfies EditorialWritingAngle;
    })
    .filter((angle) => angle.title && angle.thesis && angle.outline.length)
    .slice(0, 3);
  if (angles.length < 2) {
    return {
      value: fallback,
      generatedBy: "local",
      errorMessage:
        aiResponse.errorMessage || "DeepSeek没有返回至少两个有效写作角度",
    };
  }
  if (!angles.some((angle) => angle.recommended)) angles[0].recommended = true;
  let foundRecommendation = false;
  for (const angle of angles) {
    if (angle.recommended && !foundRecommendation) foundRecommendation = true;
    else angle.recommended = false;
  }
  return { value: angles, generatedBy: "ai" };
}

const templateRequirement: Record<EditorialTemplate, string> = {
  brief: "250-450 字原创快讯",
  knowledge_card: "500-900 字原创知识卡片",
  deep_dive: "900-1500 字原创深度稿",
};

function localDraft(
  primary: ContentItem,
  evidence: EditorialEvidencePack,
  angle: EditorialWritingAngle,
  template: EditorialTemplate,
  category: KnowledgeCategory,
): EditorialDraft {
  const facts = evidence.claims.slice(0, template === "brief" ? 3 : 6);
  return {
    title: cleanText(`${angle.title}：${primary.title}`, 180),
    content: [
      `> ${angle.thesis}`,
      "",
      "## 已确认的事实",
      "",
      ...facts.map(
        (claim) =>
          `- ${claim.claim}（证据：${claim.sourceIds.join("、")}；${claim.support === "cross_source" ? "多源印证" : "单一来源"}）`,
      ),
      "",
      "## 为什么值得关注",
      "",
      angle.readerValue,
      "",
      `## ${getKnowledgeCategory(category).label}视角`,
      "",
      angle.outline.map((item) => `- ${item}：请由编辑结合证据补充。`).join("\n"),
      "",
      "## 证据边界",
      "",
      ...(evidence.gaps.length
        ? evidence.gaps.map((gap) => `- ${gap}`)
        : ["- 当前没有记录额外证据缺口，发布前仍需人工打开原文复核。"]),
      "",
      "## 原始来源",
      "",
      `- [主材料](${primary.url})`,
    ].join("\n"),
    generatedBy: "local",
  };
}

export async function generatePipelineDraft(
  primary: ContentItem,
  related: RelatedEditorialMaterial[],
  evidence: EditorialEvidencePack,
  angle: EditorialWritingAngle,
  template: EditorialTemplate,
  category: KnowledgeCategory,
  env: AppEnv,
  sourceBundle?: EditorialSourceBundle | null,
): Promise<EditorialDraft> {
  const fallback = localDraft(primary, evidence, angle, template, category);
  const visualMedia = getUsableEditorialVisuals(sourceBundle);
  const aiResponse = await requestAiJson<Partial<EditorialDraft>>(
    env,
    [
      getKnowledgeBaseWritingPrompt("draft"),
      "你是中文科技知识库主编。只使用证据包里的事实，按选定角度从空白页面写一篇完整原创文章。不复制原文句序和段落，不写成消息摘要堆砌。事实、影响、编辑判断和证据边界要能清楚区分。visualMedia不为空时必须至少使用其中一张图片，并放在真正能解释内容的段落之后；只能使用visualMedia给出的图片地址，不能编造图片链接，也不能把video地址当成图片。末尾保留可点击来源。禁止HTML、长破折号和夸张宣传。输出严格JSON，只有title和content，content使用Markdown。",
    ].join("\n\n"),
    {
      output: templateRequirement[template],
      category: getKnowledgeCategory(category),
      selectedAngle: angle,
      evidence,
      sources: [
        { sourceId: primary.id, title: primary.title, url: primary.url },
        ...related.map((item) => ({
          sourceId: item.contentId,
          title: item.title,
          url: item.url,
        })),
      ],
      visualMedia,
      sourceVideos: (sourceBundle?.media ?? [])
        .filter((media) => media.kind === "video")
        .map((media) => ({ url: media.url, alt: media.alt })),
      sourceWarnings: sourceBundle?.warnings,
      verificationDate: new Date().toISOString().slice(0, 10),
    },
    template === "deep_dive" ? 4_200 : 3_000,
  );
  const result = aiResponse.value;
  const title = cleanText(result?.title, 260);
  const content = String(result?.content ?? "").trim().slice(0, 80_000);
  return title && content
    ? { title, content, generatedBy: "ai" }
    : {
        ...fallback,
        errorMessage:
          aiResponse.errorMessage || "DeepSeek没有返回完整的文章标题与正文",
      };
}

function localPolish(title: string, content: string): EditorialDraft {
  const polished = content
    .replace(/在当今[^，。\n]{0,40}[，。]/g, "")
    .replace(/众所周知[，,]?/g, "")
    .replace(/值得注意的是[，,]?/g, "")
    .replace(/综上所述[，,]?/g, "结论是：")
    .replace(/总的来说[，,]?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: cleanText(title, 260), content: polished, generatedBy: "local" };
}

export async function polishEditorialDraft(
  title: string,
  content: string,
  evidence: EditorialEvidencePack,
  env: AppEnv,
): Promise<EditorialDraft> {
  const fallback = localPolish(title, content);
  const aiResponse = await requestAiJson<Partial<EditorialDraft>>(
    env,
    [
      getKnowledgeBaseWritingPrompt("polish"),
      "不得增加、删除或改变事实、数字、引语、限定词、sourceIds和链接。保留有证据来源的Markdown图片及其alt文本，不把视频地址改成图片。不要假装作者亲自测试或采访。输出严格JSON，只有title和content。",
    ].join("\n\n"),
    { title, content, evidenceBoundary: { conflicts: evidence.conflicts, gaps: evidence.gaps } },
    3_500,
  );
  const result = aiResponse.value;
  const nextTitle = cleanText(result?.title, 260);
  const nextContent = String(result?.content ?? "").trim().slice(0, 80_000);
  return nextTitle && nextContent
    ? { title: nextTitle, content: nextContent, generatedBy: "ai" }
    : {
        ...fallback,
        errorMessage:
          aiResponse.errorMessage || "DeepSeek没有返回完整的润色文章",
      };
}

function localFactCheck(evidence: EditorialEvidencePack): EditorialFactCheckReport {
  const issues: EditorialFactCheckIssue[] = [
    ...evidence.claims
      .filter((claim) => claim.support === "unverified" || claim.support === "conflict")
      .map((claim) => ({
        claim: claim.claim,
        severity: claim.support === "conflict" ? "high" : "medium",
        status: claim.support === "conflict" ? "conflict" : "unsupported",
        sourceIds: claim.sourceIds,
        suggestion: "发布前打开对应来源核对；无法补证时删除或改成明确的单一来源说法。",
      }) satisfies EditorialFactCheckIssue),
    ...evidence.gaps.slice(0, 4).map((gap) => ({
      claim: gap,
      severity: "medium" as const,
      status: "partially_supported" as const,
      sourceIds: [],
      suggestion: "由人工补充权威来源，或在正文保留不确定性。",
    })),
  ];
  const checked = evidence.claims.length;
  return {
    checkedAt: new Date().toISOString(),
    claimsChecked: checked,
    supported: Math.max(0, checked - issues.length),
    needsReview: issues.length,
    issues,
  };
}

export async function factCheckEditorialDraft(
  title: string,
  content: string,
  evidence: EditorialEvidencePack,
  env: AppEnv,
): Promise<CheckedDraft> {
  const fallback = localFactCheck(evidence);
  const validSources = new Set(
    evidence.claims.flatMap((claim) => claim.sourceIds),
  );
  const aiResponse = await requestAiJson<{
    title?: string;
    content?: string;
    issues?: unknown[];
    claimsChecked?: number;
    supported?: number;
  }>(
    env,
    [
      getKnowledgeBaseWritingPrompt("fact-check"),
      "你是严格的事实核查编辑。逐条核对文章里的事实、数字、时间、因果、引语和测试结论，只能与证据包比对。找不到证据的内容必须删除、弱化为来源说法或标为待核实，不得用常识或模型记忆证明。保留观点但明确标成编辑判断。保留来源清楚的Markdown图片和原始链接，不得编造图片地址。输出严格JSON：title,content,claimsChecked,supported,issues。issues每项含claim,severity(high/medium/low),status(supported/partially_supported/unsupported/conflict),sourceIds,suggestion。",
    ].join("\n\n"),
    { title, content, evidence },
    4_000,
  );
  const result = aiResponse.value;
  const issues = (Array.isArray(result?.issues) ? result.issues : [])
    .map((entry) => {
      const issue = entry as Partial<EditorialFactCheckIssue>;
      const status = [
        "supported",
        "partially_supported",
        "unsupported",
        "conflict",
      ].includes(String(issue.status))
        ? issue.status!
        : "partially_supported";
      const severity = ["high", "medium", "low"].includes(
        String(issue.severity),
      )
        ? issue.severity!
        : "medium";
      return {
        claim: cleanText(issue.claim, 700),
        severity,
        status,
        sourceIds: stringArray(issue.sourceIds, 8).filter((id) =>
          validSources.has(id),
        ),
        suggestion: cleanText(issue.suggestion, 700),
      } satisfies EditorialFactCheckIssue;
    })
    .filter((issue) => issue.claim)
    .slice(0, 20);
  const nextTitle = cleanText(result?.title, 260);
  const nextContent = String(result?.content ?? "").trim().slice(0, 80_000);
  if (!result || !nextTitle || !nextContent) {
    return {
      title,
      content,
      generatedBy: "local",
      factCheck: fallback,
      errorMessage:
        aiResponse.errorMessage || "DeepSeek没有返回完整的事实回查结果",
    };
  }
  const claimsChecked = Math.max(0, Number(result.claimsChecked ?? 0));
  const supported = Math.min(
    claimsChecked,
    Math.max(0, Number(result.supported ?? 0)),
  );
  return {
    title: nextTitle,
    content: nextContent,
    generatedBy: "ai",
    factCheck: {
      checkedAt: new Date().toISOString(),
      claimsChecked,
      supported,
      needsReview: issues.filter((issue) => issue.status !== "supported").length,
      issues,
    },
  };
}

export function formatChineseEditorialMarkdown(
  content: string,
  sourceBundle?: EditorialSourceBundle | null,
  title = "",
): { content: string; report: EditorialFormatCheckReport } {
  const fixes = new Set<string>();
  let inCode = false;
  const lines = content.replace(/\r\n?/g, "\n").split("\n").map((raw) => {
    let line = raw.replace(/[ \t]+$/g, "");
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      return line.trim();
    }
    if (inCode) return raw;
    if (/^#(?!#)\s+/.test(line)) {
      line = line.replace(/^#\s+/, "## ");
      fixes.add("正文中的一级标题已改为二级标题");
    }
    if (/^#{2,6}[^ #]/.test(line)) {
      line = line.replace(/^(#{2,6})(?=[^ #])/, "$1 ");
      fixes.add("标题标记后已补空格");
    }
    if (/^[*•]\s+/.test(line)) {
      line = line.replace(/^[*•]\s+/, "- ");
      fixes.add("项目符号已统一");
    }
    const before = line;
    line = line.replace(/[ \t]+([，。！？；：、])/g, "$1");
    if (line !== before) fixes.add("中文标点前的多余空格已删除");
    return line;
  });
  let normalized = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized !== lines.join("\n").trim()) fixes.add("多余空行已合并");
  const issues: string[] = [];
  if (sourceBundle) {
    const visuals = getUsableEditorialVisuals(sourceBundle);
    const existingUrls = new Set(markdownImageUrls(normalized));
    const hasVerifiedVisual = visuals.some((visual) =>
      existingUrls.has(visual.url),
    );
    if (visuals.length && !hasVerifiedVisual) {
      normalized = insertPrimaryEditorialVisual(normalized, visuals[0], title);
      fixes.add("已插入来源中最重要的真实配图");
    } else if (!visuals.length) {
      issues.push(
        "当前来源未获得可用真实配图，发布前请补充产品界面、项目截图或视频关键帧。",
      );
    }
  }
  if (!/^##\s/m.test(normalized)) issues.push("正文缺少二级标题，建议人工补充层级。");
  if (/—|–/.test(normalized)) issues.push("仍包含长破折号，请核对是否改为逗号、冒号或括号。");
  if (normalized.length < 180) issues.push("正文较短，可能不足以形成完整知识条目。");
  if (/此处插图|配图建议|请编辑补充/.test(normalized)) {
    issues.push("正文仍包含内部占位语，发布前必须替换成真实内容。");
  }
  return {
    content: normalized,
    report: {
      checkedAt: new Date().toISOString(),
      passed: issues.length === 0,
      issues,
      fixesApplied: [...fixes],
    },
  };
}

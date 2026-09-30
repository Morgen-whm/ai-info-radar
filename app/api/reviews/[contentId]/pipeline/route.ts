import {
  getContentById,
  getContentReview,
  listContents,
  saveContentReview,
} from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import {
  factCheckEditorialDraft,
  findRelatedEditorialMaterials,
  formatChineseEditorialMarkdown,
  generateEditorialEvidencePack,
  generateEditorialWritingAngles,
  generatePipelineDraft,
  polishEditorialDraft,
} from "@/lib/editorial-pipeline";
import { inferKnowledgeCategory, isKnowledgeCategory } from "@/lib/knowledge";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import type {
  EditorialPipeline,
  EditorialTemplate,
  EditorialWritingAngle,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const steps = new Set([
  "related",
  "evidence",
  "angles",
  "draft",
  "polish",
  "fact-check",
  "format",
]);

const templates = new Set<EditorialTemplate>([
  "brief",
  "knowledge_card",
  "deep_dive",
]);

const pipelinePatch = (
  current: EditorialPipeline,
  patch: Partial<EditorialPipeline>,
): Partial<EditorialPipeline> => ({
  ...current,
  ...patch,
  lastError: undefined,
  updatedAt: new Date().toISOString(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const { contentId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as {
    step?: string;
    selectedAngleId?: string;
    template?: string;
    knowledgeCategory?: string;
    editorTitle?: string;
    editorContent?: string;
  };
  if (!payload.step || !steps.has(payload.step)) {
    return privateJson({ error: "编辑流水线步骤无效" }, { status: 400 });
  }

  try {
    const [source, review, env] = await Promise.all([
      getContentById(contentId),
      getContentReview(contentId),
      getAppEnv(),
    ]);
    if (!source || !review) {
      return privateJson({ error: "原始内容不存在" }, { status: 404 });
    }
    const template = templates.has(payload.template as EditorialTemplate)
      ? (payload.template as EditorialTemplate)
      : review.template;
    const knowledgeCategory = isKnowledgeCategory(payload.knowledgeCategory)
      ? payload.knowledgeCategory
      : review.knowledgeCategory || inferKnowledgeCategory(source);
    const current = review.editorialPipeline;
    const editorTitle =
      typeof payload.editorTitle === "string"
        ? payload.editorTitle.trim().slice(0, 1_000)
        : review.editorTitle;
    const editorContent =
      typeof payload.editorContent === "string"
        ? payload.editorContent.trim().slice(0, 80_000)
        : review.editorContent;
    let generatedBy: "ai" | "local" | undefined;
    let updated = review;

    if (payload.step === "related") {
      const relatedMaterials = findRelatedEditorialMaterials(
        source,
        await listContents(500),
      );
      updated = (await saveContentReview(contentId, {
        template,
        knowledgeCategory,
        status: "pending",
        editorialPipeline: pipelinePatch(current, {
          stage: "related",
          relatedMaterials,
          evidencePack: null,
          writingAngles: [],
          selectedAngleId: "",
          factCheck: null,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "evidence") {
      const result = await generateEditorialEvidencePack(
        source,
        current.relatedMaterials,
        env,
      );
      generatedBy = result.generatedBy;
      updated = (await saveContentReview(contentId, {
        template,
        knowledgeCategory,
        status: "pending",
        editorialPipeline: pipelinePatch(current, {
          stage: "evidence",
          evidencePack: result.value,
          writingAngles: [],
          selectedAngleId: "",
          factCheck: null,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "angles") {
      if (!current.evidencePack) {
        return privateJson(
          { error: "请先生成事实证据包" },
          { status: 409 },
        );
      }
      const result = await generateEditorialWritingAngles(
        source,
        current.evidencePack,
        env,
      );
      generatedBy = result.generatedBy;
      const selectedAngle =
        result.value.find((angle) => angle.recommended) || result.value[0];
      updated = (await saveContentReview(contentId, {
        template,
        knowledgeCategory,
        status: "pending",
        editorialPipeline: pipelinePatch(current, {
          stage: "angles",
          writingAngles: result.value,
          selectedAngleId: selectedAngle?.id || "",
          factCheck: null,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "draft") {
      if (!current.evidencePack || !current.writingAngles.length) {
        return privateJson(
          { error: "请先完成材料关联、证据包和写作角度分析" },
          { status: 409 },
        );
      }
      const angleId = payload.selectedAngleId || current.selectedAngleId;
      const angle =
        current.writingAngles.find((item) => item.id === angleId) ||
        current.writingAngles.find((item) => item.recommended) ||
        current.writingAngles[0];
      if (!angle) {
        return privateJson({ error: "请选择一个写作角度" }, { status: 409 });
      }
      const draft = await generatePipelineDraft(
        source,
        current.relatedMaterials,
        current.evidencePack,
        angle as EditorialWritingAngle,
        template,
        knowledgeCategory,
        env,
      );
      generatedBy = draft.generatedBy;
      updated = (await saveContentReview(contentId, {
        template,
        knowledgeCategory,
        status: "pending",
        aiDraft: draft.content,
        editorTitle: draft.title,
        editorContent: draft.content,
        editorialPipeline: pipelinePatch(current, {
          stage: "draft",
          selectedAngleId: angle.id,
          factCheck: null,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "polish") {
      if (!current.evidencePack || !editorContent) {
        return privateJson(
          { error: "请先生成文章初稿" },
          { status: 409 },
        );
      }
      const polished = await polishEditorialDraft(
        editorTitle,
        editorContent,
        current.evidencePack,
        env,
      );
      generatedBy = polished.generatedBy;
      updated = (await saveContentReview(contentId, {
        status: "pending",
        editorTitle: polished.title,
        editorContent: polished.content,
        editorialPipeline: pipelinePatch(current, {
          stage: "polished",
          factCheck: null,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "fact-check") {
      if (!current.evidencePack || !editorContent) {
        return privateJson(
          { error: "请先完成初稿和去 AI 腔" },
          { status: 409 },
        );
      }
      const checked = await factCheckEditorialDraft(
        editorTitle,
        editorContent,
        current.evidencePack,
        env,
      );
      generatedBy = checked.generatedBy;
      updated = (await saveContentReview(contentId, {
        status: "pending",
        editorTitle: checked.title,
        editorContent: checked.content,
        editorialPipeline: pipelinePatch(current, {
          stage: "fact_checked",
          factCheck: checked.factCheck,
          formatCheck: null,
        }),
      }))!;
    }

    if (payload.step === "format") {
      if (!editorContent) {
        return privateJson({ error: "没有可排版的文章" }, { status: 409 });
      }
      const formatted = formatChineseEditorialMarkdown(editorContent);
      updated = (await saveContentReview(contentId, {
        status: "pending",
        editorContent: formatted.content,
        editorialPipeline: pipelinePatch(current, {
          stage: "human_review",
          formatCheck: formatted.report,
        }),
      }))!;
    }

    return privateJson({ review: updated, generatedBy });
  } catch (error) {
    console.error("Failed to run editorial pipeline", error);
    return privateJson(
      { error: "编辑流水线执行失败，请重试当前步骤" },
      { status: 500 },
    );
  }
}

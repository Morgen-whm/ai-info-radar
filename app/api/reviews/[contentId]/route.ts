import { saveContentReview } from "@/db/repository";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { isKnowledgeCategory } from "@/lib/knowledge";
import type {
  ContentReview,
  EditorialTemplate,
  ReviewStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const reviewStatuses = new Set<ReviewStatus>([
  "pending",
  "approved",
  "needs_revision",
  "rejected",
]);
const templates = new Set<EditorialTemplate>([
  "brief",
  "knowledge_card",
  "deep_dive",
]);
const sourceTiers = new Set<ContentReview["sourceTier"]>(["S", "A", "B", "C"]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const { contentId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const input: Parameters<typeof saveContentReview>[1] = {};

  if (typeof payload.status === "string") {
    if (!reviewStatuses.has(payload.status as ReviewStatus)) {
      return privateJson({ error: "审核状态无效" }, { status: 400 });
    }
    input.status = payload.status as ReviewStatus;
  }
  if (typeof payload.template === "string") {
    if (!templates.has(payload.template as EditorialTemplate)) {
      return privateJson({ error: "发布模板无效" }, { status: 400 });
    }
    input.template = payload.template as EditorialTemplate;
  }
  if (typeof payload.sourceTier === "string") {
    if (!sourceTiers.has(payload.sourceTier as ContentReview["sourceTier"])) {
      return privateJson({ error: "来源等级无效" }, { status: 400 });
    }
    input.sourceTier = payload.sourceTier as ContentReview["sourceTier"];
  }
  if (typeof payload.knowledgeCategory === "string") {
    if (!isKnowledgeCategory(payload.knowledgeCategory)) {
      return privateJson({ error: "知识分类无效" }, { status: 400 });
    }
    input.knowledgeCategory = payload.knowledgeCategory;
  }
  for (const field of [
    "aiDraft",
    "editorTitle",
    "editorContent",
    "editorNote",
    "reviewerName",
  ] as const) {
    if (typeof payload[field] === "string") {
      const maxLength = field === "editorContent" || field === "aiDraft" ? 80_000 : 1_000;
      input[field] = payload[field].trim().slice(0, maxLength);
    }
  }
  if (typeof payload.selectedAngleId === "string") {
    input.editorialPipeline = {
      selectedAngleId: payload.selectedAngleId.trim().slice(0, 100),
    };
  }
  if (input.status === "approved") {
    const title = String(payload.editorTitle ?? "").trim();
    const content = String(payload.editorContent ?? "").trim();
    if (!title || !content) {
      return privateJson(
        { error: "审核通过前必须填写发布标题和正文" },
        { status: 400 },
      );
    }
  }
  try {
    const review = await saveContentReview(contentId, input);
    return review
      ? privateJson({ review })
      : privateJson({ error: "原始内容不存在" }, { status: 404 });
  } catch (error) {
    console.error("Failed to save content review", error);
    return privateJson({ error: "保存审核内容失败" }, { status: 500 });
  }
}

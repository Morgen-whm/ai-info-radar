import { getContentById, saveContentReview } from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { generateEditorialDraft } from "@/lib/ai";
import { inferKnowledgeCategory, isKnowledgeCategory } from "@/lib/knowledge";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import type { EditorialTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

const templates = new Set<EditorialTemplate>([
  "brief",
  "knowledge_card",
  "deep_dive",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const { contentId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as {
    template?: string;
    knowledgeCategory?: string;
  };
  const template = templates.has(payload.template as EditorialTemplate)
    ? (payload.template as EditorialTemplate)
    : "knowledge_card";
  try {
    const source = await getContentById(contentId);
    if (!source) {
      return privateJson({ error: "原始内容不存在" }, { status: 404 });
    }
    const knowledgeCategory = isKnowledgeCategory(payload.knowledgeCategory)
      ? payload.knowledgeCategory
      : inferKnowledgeCategory(source);
    const draft = await generateEditorialDraft(
      source,
      template,
      await getAppEnv(),
      knowledgeCategory,
    );
    const review = await saveContentReview(contentId, {
      template,
      knowledgeCategory,
      aiDraft: draft.content,
      editorTitle: draft.title,
      editorContent: draft.content,
      status: "pending",
    });
    return privateJson({ review, generatedBy: draft.generatedBy });
  } catch (error) {
    console.error("Failed to generate editorial draft", error);
    return privateJson({ error: "生成发布稿失败" }, { status: 500 });
  }
}

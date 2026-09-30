import {
  createRewriteJob,
  getContentById,
  saveContentReview,
  setRewriteCandidate,
} from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { createEmptyEditorialPipeline } from "@/lib/editorial-pipeline";
import { knowledgeBaseWritingProfile } from "@/lib/editorial-profiles";
import { inferKnowledgeCategory, isKnowledgeCategory } from "@/lib/knowledge";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { readTikHubCredential } from "@/lib/tikhub-credentials";
import type { EditorialTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

const templates = new Set<EditorialTemplate>([
  "brief",
  "knowledge_card",
  "deep_dive",
]);

export async function POST(request: Request) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const payload = (await request.json().catch(() => ({}))) as {
    contentId?: string;
    template?: string;
    knowledgeCategory?: string;
  };
  if (!payload.contentId) {
    return privateJson({ error: "缺少contentId" }, { status: 400 });
  }

  try {
    const [content, env] = await Promise.all([
      getContentById(payload.contentId),
      getAppEnv(),
    ]);
    if (!content) {
      return privateJson({ error: "原始内容不存在" }, { status: 404 });
    }
    if (!env.AI_API_KEY) {
      return privateJson(
        { error: "请先配置AI_API_KEY，一键改写不使用固定本地模板" },
        { status: 409 },
      );
    }
    if (content.platform === "x" || content.platform === "youtube") {
      const personalCredential = await readTikHubCredential(
        request.headers.get("cookie"),
        env,
      );
      if (!personalCredential?.apiKey && !env.TIKHUB_TOKEN) {
        return privateJson(
          { error: "请先在设置中配置个人TikHub API Key，用于补全原文与字幕" },
          { status: 409 },
        );
      }
    }

    const template = templates.has(payload.template as EditorialTemplate)
      ? (payload.template as EditorialTemplate)
      : "knowledge_card";
    const knowledgeCategory = isKnowledgeCategory(payload.knowledgeCategory)
      ? payload.knowledgeCategory
      : inferKnowledgeCategory(content);
    const pipeline = createEmptyEditorialPipeline();
    pipeline.writingProfileId = knowledgeBaseWritingProfile.id;
    pipeline.writingProfileVersion = knowledgeBaseWritingProfile.version;

    await setRewriteCandidate(content.id, true);
    await saveContentReview(content.id, {
      status: "pending",
      template,
      knowledgeCategory,
      editorialPipeline: pipeline,
    });
    const job = await createRewriteJob({
      contentId: content.id,
      profileId: knowledgeBaseWritingProfile.id,
      profileVersion: knowledgeBaseWritingProfile.version,
      template,
      knowledgeCategory,
    });
    return job
      ? privateJson({ job, selected: true }, { status: 201 })
      : privateJson({ error: "创建改写任务失败" }, { status: 500 });
  } catch (error) {
    console.error("Failed to create rewrite job", error);
    return privateJson(
      { error: error instanceof Error ? error.message : "创建改写任务失败" },
      { status: 500 },
    );
  }
}

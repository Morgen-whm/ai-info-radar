import type { AppEnv } from "@/db/runtime";
import {
  getContentById,
  getContentReview,
  getRewriteJob,
  listContents,
  saveContentReview,
  updateRewriteJob,
} from "@/db/repository";
import {
  factCheckEditorialDraft,
  findRelatedEditorialMaterials,
  formatChineseEditorialMarkdown,
  generateEditorialEvidencePack,
  generateEditorialWritingAngles,
  generatePipelineDraft,
  polishEditorialDraft,
} from "@/lib/editorial-pipeline";
import { enrichEditorialSource } from "@/lib/source-enrichment";
import type {
  EditorialPipeline,
  EditorialWritingAngle,
  RewriteJob,
} from "@/lib/types";

const pipelinePatch = (
  current: EditorialPipeline,
  patch: Partial<EditorialPipeline>,
): Partial<EditorialPipeline> => ({
  ...current,
  ...patch,
  lastError: undefined,
  updatedAt: new Date().toISOString(),
});

const requireAiResult = (
  generatedBy: "ai" | "local",
  stage: string,
  errorMessage?: string,
) => {
  if (generatedBy === "local") {
    throw new Error(
      `${stage}没有获得可用的AI结果，已停止任务，避免用固定模板覆盖文章。${errorMessage ? ` 原因：${errorMessage}` : ""}`,
    );
  }
};

export async function advanceRewriteJob(
  jobId: string,
  env: AppEnv,
): Promise<RewriteJob> {
  const job = await getRewriteJob(jobId);
  if (!job) throw new Error("改写任务不存在");
  if (job.status === "completed" || job.stage === "human_review") return job;
  if (job.status === "failed") {
    throw new Error(job.errorMessage || "改写任务已失败");
  }

  const [source, review] = await Promise.all([
    getContentById(job.contentId),
    getContentReview(job.contentId),
  ]);
  if (!source || !review) throw new Error("改写的原始内容不存在");
  const current = review.editorialPipeline;

  if (job.stage === "queued") {
    await updateRewriteJob(job.id, {
      status: "running",
      stage: "enriching",
      progress: 5,
      message:
        source.platform === "youtube"
          ? "正在获取视频详情与字幕"
          : source.platform === "x"
            ? "正在获取X详情、串文与媒体"
            : "正在整理原始内容",
    });
    const sourceBundle = await enrichEditorialSource(source, env);
    await saveContentReview(job.contentId, {
      status: "pending",
      template: job.template,
      knowledgeCategory: job.knowledgeCategory,
      editorialPipeline: pipelinePatch(current, {
        stage: "source",
        writingProfileId: job.profileId,
        writingProfileVersion: job.profileVersion,
        sourceBundle,
        relatedMaterials: [],
        evidencePack: null,
        writingAngles: [],
        selectedAngleId: "",
        factCheck: null,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      status: "running",
      stage: "related",
      progress: 16,
      message: sourceBundle.warnings.length
        ? `原始内容已整理，${sourceBundle.warnings.length}项需人工留意`
        : "原始内容已补全，正在准备关联材料",
    }))!;
  }

  if (job.stage === "enriching") {
    throw new Error("上一次来源补全未完成，请重新发起任务");
  }

  if (job.stage === "related") {
    const candidates = await listContents(500);
    const relatedMaterials = findRelatedEditorialMaterials(source, candidates);
    await saveContentReview(job.contentId, {
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
    });
    return (await updateRewriteJob(job.id, {
      stage: "evidence",
      progress: 28,
      message: `已关联${relatedMaterials.length}份同话题材料，准备生成事实证据`,
    }))!;
  }

  if (job.stage === "evidence") {
    const allContents = await listContents(500);
    const result = await generateEditorialEvidencePack(
      source,
      current.relatedMaterials,
      env,
      {
        sourceBundle: current.sourceBundle,
        relatedContents: allContents.filter((item) =>
          current.relatedMaterials.some(
            (material) => material.contentId === item.id,
          ),
        ),
      },
    );
    requireAiResult(result.generatedBy, "事实证据包", result.errorMessage);
    await saveContentReview(job.contentId, {
      status: "pending",
      editorialPipeline: pipelinePatch(current, {
        stage: "evidence",
        evidencePack: result.value,
        writingAngles: [],
        selectedAngleId: "",
        factCheck: null,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      stage: "angles",
      progress: 42,
      message: `已整理${result.value.claims.length}条可追溯声明，准备选择写作角度`,
    }))!;
  }

  if (job.stage === "angles") {
    if (!current.evidencePack) throw new Error("事实证据包缺失");
    const result = await generateEditorialWritingAngles(
      source,
      current.evidencePack,
      env,
    );
    requireAiResult(result.generatedBy, "写作角度", result.errorMessage);
    const selectedAngle =
      result.value.find((angle) => angle.recommended) || result.value[0];
    await saveContentReview(job.contentId, {
      status: "pending",
      editorialPipeline: pipelinePatch(current, {
        stage: "angles",
        writingAngles: result.value,
        selectedAngleId: selectedAngle?.id || "",
        factCheck: null,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      stage: "draft",
      progress: 54,
      message: `已自动选择“${selectedAngle?.title || "推荐角度"}”，准备生成文章`,
    }))!;
  }

  if (job.stage === "draft") {
    if (!current.evidencePack || !current.writingAngles.length) {
      throw new Error("证据包或写作角度缺失");
    }
    const angle =
      current.writingAngles.find(
        (item) => item.id === current.selectedAngleId,
      ) ||
      current.writingAngles.find((item) => item.recommended) ||
      current.writingAngles[0];
    const result = await generatePipelineDraft(
      source,
      current.relatedMaterials,
      current.evidencePack,
      angle as EditorialWritingAngle,
      job.template,
      job.knowledgeCategory,
      env,
      current.sourceBundle,
    );
    requireAiResult(result.generatedBy, "文章初稿", result.errorMessage);
    await saveContentReview(job.contentId, {
      status: "pending",
      aiDraft: result.content,
      editorTitle: result.title,
      editorContent: result.content,
      editorialPipeline: pipelinePatch(current, {
        stage: "draft",
        selectedAngleId: angle.id,
        factCheck: null,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      stage: "polish",
      progress: 68,
      message: "初稿已生成，准备进行中文母语化润色",
    }))!;
  }

  if (job.stage === "polish") {
    if (!current.evidencePack || !review.editorContent) {
      throw new Error("初稿或证据包缺失");
    }
    const result = await polishEditorialDraft(
      review.editorTitle,
      review.editorContent,
      current.evidencePack,
      env,
    );
    requireAiResult(
      result.generatedBy,
      "中文母语化润色",
      result.errorMessage,
    );
    await saveContentReview(job.contentId, {
      status: "pending",
      editorTitle: result.title,
      editorContent: result.content,
      editorialPipeline: pipelinePatch(current, {
        stage: "polished",
        factCheck: null,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      stage: "fact_check",
      progress: 80,
      message: "母语化润色完成，准备回查文章事实",
    }))!;
  }

  if (job.stage === "fact_check") {
    if (!current.evidencePack || !review.editorContent) {
      throw new Error("待核查文章或证据包缺失");
    }
    const result = await factCheckEditorialDraft(
      review.editorTitle,
      review.editorContent,
      current.evidencePack,
      env,
    );
    requireAiResult(result.generatedBy, "事实回查", result.errorMessage);
    await saveContentReview(job.contentId, {
      status: "pending",
      editorTitle: result.title,
      editorContent: result.content,
      editorialPipeline: pipelinePatch(current, {
        stage: "fact_checked",
        factCheck: result.factCheck,
        formatCheck: null,
      }),
    });
    return (await updateRewriteJob(job.id, {
      stage: "format",
      progress: 92,
      message: `事实回查完成，${result.factCheck.needsReview}项留待人工处理`,
    }))!;
  }

  if (job.stage === "format") {
    if (!review.editorContent) throw new Error("没有可排版的文章");
    const formatted = formatChineseEditorialMarkdown(
      review.editorContent,
      current.sourceBundle,
      review.editorTitle,
    );
    await saveContentReview(job.contentId, {
      status: "pending",
      editorContent: formatted.content,
      editorialPipeline: pipelinePatch(current, {
        stage: "human_review",
        formatCheck: formatted.report,
      }),
    });
    const completedAt = new Date().toISOString();
    return (await updateRewriteJob(job.id, {
      status: "completed",
      stage: "human_review",
      progress: 100,
      message: "改写与质检已完成，等待人工审核",
      completedAt,
    }))!;
  }

  throw new Error(`不支持的改写阶段：${job.stage}`);
}

export async function failRewriteJob(
  jobId: string,
  error: unknown,
): Promise<RewriteJob | null> {
  const message = error instanceof Error ? error.message : "改写任务失败";
  return updateRewriteJob(jobId, {
    status: "failed",
    message: "改写任务已停止",
    errorMessage: message,
    completedAt: new Date().toISOString(),
  });
}

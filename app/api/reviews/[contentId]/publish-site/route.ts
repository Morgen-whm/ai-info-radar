import {
  getContentReview,
  publishReviewToKnowledgeSite,
  setReviewSitePublicationState,
} from "@/db/repository";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  const { contentId } = await context.params;
  const review = await getContentReview(contentId);
  if (!review) {
    return privateJson({ error: "审核内容不存在" }, { status: 404 });
  }
  if (review.status !== "approved") {
    return privateJson(
      { error: "请先核对原文并将内容标记为通过" },
      { status: 409 },
    );
  }
  if (!review.editorTitle.trim() || !review.editorContent.trim()) {
    return privateJson(
      { error: "发布前必须完成原创标题和正文" },
      { status: 400 },
    );
  }

  await setReviewSitePublicationState(contentId, { status: "publishing" });
  try {
    const result = await publishReviewToKnowledgeSite(review);
    return privateJson(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "知识库网站发布失败";
    await setReviewSitePublicationState(contentId, {
      status: "failed",
      error: message.slice(0, 500),
    });
    console.error("Failed to publish review to knowledge site", error);
    return privateJson({ error: message }, { status: 500 });
  }
}

import {
  getContentReview,
  listPublishedFeishuReviews,
  setReviewPublicationState,
} from "@/db/repository";
import { getAppEnv } from "@/db/runtime";
import { publishReviewToFeishu } from "@/lib/feishu";
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
      { error: "请先完成人工审核并将内容标记为通过" },
      { status: 409 },
    );
  }
  await setReviewPublicationState(contentId, { status: "publishing" });
  try {
    const [env, publishedReviews] = await Promise.all([
      getAppEnv(),
      listPublishedFeishuReviews(),
    ]);
    const result = await publishReviewToFeishu(
      review,
      env,
      publishedReviews,
    );
    const updated = await setReviewPublicationState(contentId, {
      status: "published",
      documentId: result.documentId,
      wikiNodeToken: result.wikiNodeToken,
      url: result.url,
      contentHash: result.contentHash,
    });
    return privateJson({ review: updated, publication: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "飞书发布失败";
    await setReviewPublicationState(contentId, {
      status: "failed",
      error: message.slice(0, 500),
    });
    console.error("Failed to publish review to Feishu", error);
    return privateJson({ error: message }, { status: 502 });
  }
}

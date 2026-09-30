import { saveReviewInboxLink } from "@/db/repository";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;

  const { contentId } = await context.params;
  try {
    const link = await saveReviewInboxLink(contentId);
    return link
      ? privateJson({ link })
      : privateJson({ error: "原始内容不存在" }, { status: 404 });
  } catch (error) {
    console.error("Failed to save review inbox link", error);
    return privateJson({ error: "存入审核中心失败" }, { status: 500 });
  }
}

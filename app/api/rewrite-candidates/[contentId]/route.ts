import { setRewriteCandidate } from "@/db/repository";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

async function updateCandidate(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
  selected: boolean,
) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;

  const { contentId } = await context.params;
  try {
    const item = await setRewriteCandidate(contentId, selected);
    return item
      ? privateJson({ item, selected })
      : privateJson({ error: "原始内容不存在" }, { status: 404 });
  } catch (error) {
    console.error("Failed to update rewrite candidate", error);
    return privateJson(
      { error: selected ? "加入改写备选失败" : "移出改写备选失败" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  return updateCandidate(request, context, true);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
) {
  return updateCandidate(request, context, false);
}

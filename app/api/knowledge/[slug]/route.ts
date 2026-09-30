import { getKnowledgeArticleBySlug } from "@/db/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    const article = await getKnowledgeArticleBySlug(slug);
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 });
    }
    return Response.json(
      { article },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load knowledge article", error);
    return Response.json({ error: "无法读取知识文章" }, { status: 500 });
  }
}

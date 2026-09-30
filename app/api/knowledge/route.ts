import { listKnowledgeArticles } from "@/db/repository";
import { isKnowledgeCategory } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedCategory = url.searchParams.get("category");
  const category = isKnowledgeCategory(requestedCategory)
    ? requestedCategory
    : "all";
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") || 60) || 60),
  );
  try {
    const articles = await listKnowledgeArticles({ category, query, limit });
    return Response.json(
      { articles },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load knowledge articles", error);
    return Response.json(
      { error: "无法读取知识库文章" },
      { status: 500 },
    );
  }
}

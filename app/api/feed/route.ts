import { listContents } from "@/db/repository";
import { demoItems } from "@/lib/demo-data";
import type { Platform } from "@/lib/types";
import { recommendationScore } from "@/lib/content-value";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") as Platform | null;
  const sort = url.searchParams.get("sort") || "recommended";
  const query = (url.searchParams.get("q") || "").toLowerCase();
  const minScore = Math.min(
    100,
    Math.max(0, Number(url.searchParams.get("minScore") ?? 50) || 0),
  );
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500),
  );

  let items;
  try {
    const stored = await listContents(500);
    items = stored.length ? stored : demoItems;
  } catch {
    items = demoItems;
  }

  const filtered = items
    .filter((item) => !platform || item.platform === platform)
    .filter((item) => item.hotScore >= minScore)
    .filter(
      (item) =>
        !query ||
        `${item.title} ${item.body} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => {
      if (sort === "value" || sort === "hot") return b.hotScore - a.hotScore;
      if (sort === "recommended") {
        return recommendationScore(b) - recommendationScore(a);
      }
      return (
        new Date(b.publishedAt).getTime() -
        new Date(a.publishedAt).getTime()
      );
    });

  return Response.json({
    items: filtered.slice(0, limit),
    total: filtered.length,
    sort,
    minScore,
    limit,
  });
}

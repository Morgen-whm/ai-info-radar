import {
  getReviewQueueStats,
  listContentReviews,
} from "@/db/repository";
import type { ReviewStatus } from "@/lib/types";
import { privateJson } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

const statuses = new Set(["all", "pending", "approved", "needs_revision", "rejected"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") || "all";
  const status = statuses.has(requestedStatus)
    ? (requestedStatus as ReviewStatus | "all")
    : "all";
  const query = url.searchParams.get("q") || "";
  const requestedFocus = url.searchParams.get("focus");
  const focus =
    requestedFocus === "all" || requestedFocus === "knowledge"
      ? requestedFocus
      : "candidates";
  const limit = Math.min(
    300,
    Math.max(1, Number(url.searchParams.get("limit") || 120) || 120),
  );
  try {
    const [reviews, stats] = await Promise.all([
      listContentReviews({ status, query, limit, focus }),
      getReviewQueueStats(focus),
    ]);
    return privateJson({ reviews, stats });
  } catch (error) {
    console.error("Failed to load review queue", error);
    return privateJson({ error: "无法读取审核队列" }, { status: 500 });
  }
}

import { currentWeekStartInShanghai, generateWeeklyReport } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin !== requestUrl.origin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return Response.json(
      { error: "只允许站内操作" },
      { status: 403, headers },
    );
  }

  try {
    const { report } = await generateWeeklyReport({
      weekStart: currentWeekStartInShanghai(),
      force: true,
    });
    return Response.json({ report }, { headers });
  } catch (error) {
    console.error("Failed to refresh current weekly report", error);
    return Response.json(
      { error: "周报更新失败，请确认数据库中已有本周采集内容" },
      { status: 500, headers },
    );
  }
}

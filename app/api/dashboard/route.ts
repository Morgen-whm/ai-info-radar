import {
  demoDashboard,
  demoItems,
  demoJobs,
} from "@/lib/demo-data";
import { getAppEnv } from "@/db/runtime";
import {
  getContentStats,
  listJobs,
  listRecommendedContents,
  listSources,
} from "@/db/repository";
import { getLiveTopics } from "@/lib/live-topics";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = await getAppEnv();
  try {
    const [sources, storedItems, storedJobs, contentStats, hotTopics] = await Promise.all([
      listSources(),
      listRecommendedContents(20),
      listJobs(20),
      getContentStats(),
      getLiveTopics({ hours: 72, limit: 12 }),
    ]);
    const latestItems = storedItems.length ? storedItems : demoItems;
    const jobs = storedJobs.length ? storedJobs : demoJobs;
    const completedJobs = jobs.filter(
      (job) => job.status === "succeeded" || job.status === "failed",
    );
    const successRate = completedJobs.length
      ? Math.round(
          (completedJobs.filter((job) => job.status === "succeeded").length /
            completedJobs.length) *
            1000,
        ) / 10
      : 100;
    return Response.json({
      ...demoDashboard,
      mode:
        contentStats.total > 0 || env.DATA_MODE === "live" ? "live" : "demo",
      generatedAt: new Date().toISOString(),
      sources,
      latestItems,
      jobs,
      hotTopics,
      stats: {
        ...demoDashboard.stats,
        contents24h:
          contentStats.total > 0
            ? contentStats.contents24h
            : demoDashboard.stats.contents24h,
        activeSources: sources.filter((source) => source.enabled).length,
        successRate,
        hotTopics: hotTopics.length,
      },
      platformCounts:
        contentStats.total > 0
          ? contentStats.platformCounts
          : demoDashboard.platformCounts,
    });
  } catch {
    return Response.json({
      ...demoDashboard,
      hotTopics: [],
      stats: {
        ...demoDashboard.stats,
        hotTopics: 0,
      },
    });
  }
}

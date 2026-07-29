import type { Metadata } from "next";
import { demoJobs } from "@/lib/demo-data";
import { JobMonitor } from "./JobMonitor";
import { listJobs } from "@/db/repository";

export const metadata: Metadata = {
  title: "采集任务",
};

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  let jobs = demoJobs;
  try {
    const storedJobs = await listJobs(100);
    if (storedJobs.length) jobs = storedJobs;
  } catch {
    // Keep the route useful when the local database is unavailable.
  }
  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">COLLECTION OPERATIONS</span>
          <h1>采集任务</h1>
          <p>查看采集耗时、新增内容、失败原因和退避状态。</p>
        </div>
      </header>
      <JobMonitor initialJobs={jobs} />
    </main>
  );
}

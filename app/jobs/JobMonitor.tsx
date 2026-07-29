"use client";

import { useState } from "react";
import { PlatformBadge } from "@/components/PlatformBadge";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type { CollectionJob } from "@/lib/types";

const statusLabels: Record<CollectionJob["status"], string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
};

export function JobMonitor({ initialJobs }: { initialJobs: CollectionJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/jobs");
      const payload = (await response.json()) as { jobs: CollectionJob[] };
      setJobs(payload.jobs);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <div className="job-toolbar">
        <div className="job-summary">
          <span>
            <strong>{jobs.filter((job) => job.status === "succeeded").length}</strong>
            成功
          </span>
          <span>
            <strong>{jobs.filter((job) => job.status === "running").length}</strong>
            执行中
          </span>
          <span>
            <strong>{jobs.filter((job) => job.status === "failed").length}</strong>
            异常
          </span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "刷新中…" : "刷新任务"}
        </button>
      </div>
      <div className="table-scroll">
        <table className="job-table">
          <thead>
            <tr>
              <th>来源</th>
              <th>状态</th>
              <th>发现 / 新增</th>
              <th>耗时</th>
              <th>开始时间</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <div className="table-source">
                    <PlatformBadge platform={job.platform} compact />
                    <span>{job.sourceName}</span>
                  </div>
                </td>
                <td>
                  <span className={`job-status job-${job.status}`}>
                    {statusLabels[job.status]}
                  </span>
                </td>
                <td>
                  {job.itemsFound} / <strong>{job.itemsAdded}</strong>
                </td>
                <td>{formatDuration(job.durationMs)}</td>
                <td>{formatRelativeTime(job.startedAt)}</td>
                <td className={job.errorMessage ? "error-text" : ""}>
                  {job.errorMessage || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

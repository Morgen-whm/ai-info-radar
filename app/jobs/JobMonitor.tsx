"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    try {
      const response = await fetch("/api/jobs", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as { jobs?: CollectionJob[]; error?: string };
      if (!response.ok || !Array.isArray(payload.jobs)) {
        throw new Error(payload.error || "任务状态更新失败，将自动重试");
      }
      setJobs(payload.jobs);
      setError("");
    } catch (error) {
      if (timedOut) {
        setError("任务状态请求超时，将自动重试");
      } else if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "任务状态更新失败，将自动重试");
      }
    } finally {
      clearTimeout(timeout);
      requestRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refresh();
      if (!stopped) timer = setTimeout(poll, 5_000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      requestRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

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
      <p role="status" aria-live="polite">
        {error || "任务状态每 5 秒自动更新，无需手动刷新。"}
      </p>
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

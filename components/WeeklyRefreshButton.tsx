"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WeeklyRefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshReport() {
    setRefreshing(true);
    setMessage("");
    try {
      const response = await fetch("/api/weekly-reports/refresh-current", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as {
        report?: { reportId: string; topics: unknown[] };
        error?: string;
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error || "周报更新失败");
      }
      setMessage(
        `已更新 ${payload.report.reportId}，精选 ${payload.report.topics.length} 条`,
      );
      router.replace(`/weekly?reportId=${payload.report.reportId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "周报更新失败");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="weekly-refresh">
      <button
        type="button"
        className="button button-primary"
        disabled={refreshing}
        onClick={refreshReport}
      >
        {refreshing ? "正在筛选本周热点…" : "更新本周周报"}
      </button>
      {message ? <span>{message}</span> : null}
    </div>
  );
}

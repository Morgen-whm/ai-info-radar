"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadLinuxFeeds } from "@/lib/client-sync";
import type { Source } from "@/lib/types";

export function QuickSyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  async function syncAll() {
    setSyncing(true);
    setMessage("");
    try {
      const sourceResponse = await fetch("/api/sources");
      const sourcePayload = (await sourceResponse.json()) as {
        sources?: Source[];
      };
      if (!sourceResponse.ok || !sourcePayload.sources) {
        throw new Error("无法读取监测源");
      }
      const linuxFeeds = await loadLinuxFeeds(sourcePayload.sources);
      const response = await fetch("/api/sync/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linuxFeeds }),
      });
      const payload = (await response.json()) as {
        succeeded?: number;
        failed?: number;
        itemsAdded?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "采集失败");
      setMessage(
        `成功 ${payload.succeeded ?? 0}，失败 ${payload.failed ?? 0}，新增 ${payload.itemsAdded ?? 0} 条`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采集失败");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="quick-sync">
      <button
        type="button"
        className="button button-secondary"
        disabled={syncing}
        onClick={syncAll}
      >
        {syncing ? "采集中…" : "一键采集全部"}
      </button>
      {message ? <span>{message}</span> : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { collectAllSources, loadLinuxFeeds } from "@/lib/client-sync";
import { formatCollectionProgress } from "@/lib/collection-progress";
import type { Source } from "@/lib/types";

export function QuickSyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function syncAll() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    setMessage("正在准备监测源，采集进度将自动更新…");
    try {
      const sourceResponse = await fetch("/api/sources", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const sourcePayload = (await sourceResponse.json()) as {
        sources?: Source[];
      };
      if (!sourceResponse.ok || !sourcePayload.sources) {
        throw new Error("无法读取监测源");
      }
      const linuxFeeds = await loadLinuxFeeds(sourcePayload.sources);
      let completed = 0;
      const payload = await collectAllSources(linuxFeeds, (progress) => {
        setMessage(formatCollectionProgress(progress));
        if (progress.completed > completed) {
          completed = progress.completed;
          router.refresh();
        }
      });
      setMessage(
        `采集完成：成功 ${payload.succeeded}，失败 ${payload.failed}，新增 ${payload.itemsAdded} 条`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采集失败");
    } finally {
      inFlight.current = false;
      setSyncing(false);
      router.refresh();
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
      {message ? <span role="status" aria-live="polite">{message}</span> : null}
    </div>
  );
}

export interface CollectionResult {
  sourceId: string;
  sourceName: string;
  ok: boolean;
  itemsFound?: number;
  itemsAdded?: number;
  error?: string;
}

export interface CollectionSummary {
  results: CollectionResult[];
  succeeded: number;
  failed: number;
  itemsAdded: number;
}

export interface CollectionProgress {
  total: number;
  completed: number;
  currentSourceName?: string;
  succeeded: number;
  failed: number;
  itemsAdded: number;
}

export type CollectionEvent =
  | ({ type: "progress" } & CollectionProgress)
  | ({ type: "complete" } & CollectionSummary)
  | { type: "heartbeat" }
  | { type: "error"; error: string };

export function summarizeCollection(results: CollectionResult[]): CollectionSummary {
  return {
    results,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    itemsAdded: results.reduce((sum, item) => sum + (item.itemsAdded ?? 0), 0),
  };
}

export function formatCollectionProgress(progress: CollectionProgress): string {
  return `已完成 ${progress.completed}/${progress.total} 个来源，成功 ${progress.succeeded}，失败 ${progress.failed}，新增 ${progress.itemsAdded} 条${progress.currentSourceName ? `；正在采集 ${progress.currentSourceName}` : ""}`;
}

// Opt-in streaming keeps existing JSON API callers compatible. Heartbeats keep
// a slow source distinguishable from a disconnected progress connection.
export function collectionProgressResponse(
  collect: (emit: (event: CollectionEvent) => void) => Promise<CollectionSummary>,
  heartbeatMs = 10_000,
): Response {
  const encoder = new TextEncoder();
  let connected = true;
  let heartbeat: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: CollectionEvent) => {
        if (connected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      heartbeat = setInterval(() => emit({ type: "heartbeat" }), heartbeatMs);
      void (async () => {
        try {
          const summary = await collect(emit);
          emit({ type: "complete", ...summary });
        } catch (error) {
          emit({ type: "error", error: error instanceof Error ? error.message : "采集失败" });
        } finally {
          clearInterval(heartbeat);
          if (connected) {
            connected = false;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      connected = false;
      clearInterval(heartbeat);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function readCollectionResponse(
  response: Response,
  onProgress: (progress: CollectionProgress) => void,
  onActivity: () => void = () => {},
): Promise<CollectionSummary> {
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    const payload = (await response.json()) as CollectionSummary & { error?: string };
    if (!response.ok) throw new Error(payload.error || "采集失败");
    return payload;
  }
  if (!response.body) throw new Error("无法读取采集进度");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      onActivity();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as CollectionEvent;
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "progress") onProgress(event);
        // Do not wait for TCP EOF after the explicit completion event.
        if (event.type === "complete") return event;
      }
      if (done) throw new Error("采集进度连接已中断，未收到完成确认；请查看采集任务，勿重复提交");
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

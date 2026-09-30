/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { syncAllDueSources } from "../lib/sync";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DATA_MODE?: "demo" | "live";
  TIKHUB_BASE_URL?: string;
  TIKHUB_TOKEN?: string;
  TIKHUB_KEY_ENCRYPTION_SECRET?: string;
  LINUXDO_SCHEDULE_MODE?: "direct" | "external";
  IDCFLARE_SCHEDULE_MODE?: "direct" | "external";
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  WECHAT_AUTHOR?: string;
  WECHAT_IMAGE_HOSTS?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_TOKEN?: string;
  CRON_SECRET?: string;
  WEEKLY_API_KEY?: string;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_WIKI_SPACE_ID?: string;
  FEISHU_WIKI_PARENT_NODE_TOKEN?: string;
  FEISHU_FOLDER_TOKEN?: string;
  FEISHU_TENANT_DOMAIN?: string;
  FEISHU_DAILY_DOCUMENT_ID?: string;
  FEISHU_DAILY_WIKI_NODE_TOKEN?: string;
  FEISHU_DAILY_DOCUMENT_TITLE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (env.DATA_MODE !== "live") return;
    ctx.waitUntil(syncAllDueSources(env));
  },
};

export default worker;

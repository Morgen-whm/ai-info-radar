import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const host = "127.0.0.1";
const port = Number(process.env.LINUXDO_PROXY_PORT || 4317);
const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const execFileAsync = promisify(execFile);
const gitLabFeeds = new Set([
  "https://about.gitlab.com/atom.xml",
  "https://docs.gitlab.com/releases/releases.xml",
  "https://docs.gitlab.com/releases/patch-releases.xml",
  "https://docs.gitlab.com/releases/all-releases.xml",
]);

function send(
  response,
  status,
  body,
  contentType = "text/plain; charset=utf-8",
  headers = {},
) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  const corsHeaders =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "600",
    });
    response.end();
    return;
  }
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  if (requestUrl.pathname === "/health") {
    send(response, 200, "ok", undefined, corsHeaders);
    return;
  }
  if (request.method !== "GET" || requestUrl.pathname !== "/rss") {
    send(response, 404, "Not found", undefined, corsHeaders);
    return;
  }

  let target;
  try {
    target = new URL(requestUrl.searchParams.get("url") || "");
  } catch {
    send(response, 400, "Invalid RSS URL", undefined, corsHeaders);
    return;
  }
  const isCommunityRss =
    target.protocol === "https:" &&
    ["linux.do", "idcflare.com"].includes(target.hostname) &&
    target.pathname.endsWith(".rss");
  const isGitLabFeed =
    target.protocol === "https:" && gitLabFeeds.has(target.toString());
  if (!isCommunityRss && !isGitLabFeed) {
    send(
      response,
      403,
      "Only approved Linux.do, IDCFlare, and GitLab feeds are allowed",
      undefined,
      corsHeaders,
    );
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-sS",
        "-L",
        "--fail-with-body",
        "--max-time",
        "30",
        "-A",
        browserUserAgent,
        "-H",
        "Accept: application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        "-H",
        "Accept-Language: zh-CN,zh;q=0.9,en;q=0.7",
        target.toString(),
      ],
      {
        encoding: "buffer",
        maxBuffer: 5_000_000,
      },
    );
    if (!stdout.includes(Buffer.from("<rss")) && !stdout.includes(Buffer.from("<feed"))) {
      send(
        response,
        502,
        "Public source returned invalid RSS or Atom",
        undefined,
        corsHeaders,
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "private, max-age=30",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders,
    });
    response.end(stdout);
  } catch (error) {
    send(
      response,
      502,
      error instanceof Error ? error.message : "RSS proxy failed",
      undefined,
      corsHeaders,
    );
  }
});

server.listen(port, host, () => {
  console.log(`[linuxdo-rss-proxy] http://${host}:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`[linuxdo-rss-proxy] ${host}:${port} is already running`);
    process.exit(0);
  }
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

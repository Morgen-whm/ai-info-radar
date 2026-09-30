const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function privateJson(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: { ...privateHeaders, ...init.headers },
  });
}

export function requireSameOrigin(request: Request): Response | null {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin !== requestUrl.origin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return privateJson({ error: "只允许站内操作" }, { status: 403 });
  }
  return null;
}

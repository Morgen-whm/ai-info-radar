import type { AppEnv } from "@/db/runtime";
import {
  authorFrom,
  collectCandidateObjects,
  firstNumber,
  firstString,
  normalizeDate,
  record,
} from "@/lib/connectors/helpers";
import { requestTikHub } from "@/lib/tikhub-client";
import type {
  ContentItem,
  EditorialMediaAsset,
  EditorialSourceBundle,
  EditorialThreadItem,
} from "@/lib/types";

const MAX_SOURCE_TEXT = 80_000;
const MAX_TRANSCRIPT_TEXT = 60_000;

const cleanText = (value: unknown, max = MAX_SOURCE_TEXT) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

const normalizedHandle = (value: string | undefined) =>
  String(value ?? "").replace(/^@/, "").trim().toLowerCase();

const safeHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.replace(/&amp;/g, "&"));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const tweetText = (item: Record<string, unknown>) => {
  const legacy = record(item.legacy);
  const noteTweet = record(
    record(record(item.note_tweet).note_tweet_results).result,
  );
  return firstString(
    { ...item, ...legacy, ...noteTweet },
    ["full_text", "text", "content"],
  );
};

const tweetId = (item: Record<string, unknown>) =>
  firstString({ ...item, ...record(item.legacy) }, [
    "tweet_id",
    "rest_id",
    "id_str",
    "id",
  ]);

function extractTweetItems(root: unknown): EditorialThreadItem[] {
  const candidates = collectCandidateObjects(
    root,
    (item) => Boolean(tweetId(item) && tweetText(item)),
    100,
  );
  const deduped = new Map<string, EditorialThreadItem>();
  for (const item of candidates) {
    const id = tweetId(item);
    const text = tweetText(item);
    if (!id || !text || deduped.has(id)) continue;
    const author = authorFrom(item, "x");
    const handle = normalizedHandle(author.handle);
    const legacy = record(item.legacy);
    deduped.set(id, {
      id,
      kind: "thread",
      text: cleanText(text, 12_000),
      authorName: author.name,
      authorHandle: handle ? `@${handle}` : undefined,
      url: handle ? `https://x.com/${handle}/status/${id}` : undefined,
      publishedAt: normalizeDate(
        legacy.created_at ?? item.created_at ?? item.timestamp,
      ),
    });
  }
  return [...deduped.values()];
}

function mediaAssetsFromX(
  root: unknown,
  sourceUrl: string,
): EditorialMediaAsset[] {
  const candidates = collectCandidateObjects(
    root,
    (item) =>
      Boolean(
        item.media_url_https ||
          item.media_url ||
          item.video_info ||
          item.videoInfo ||
          item.original_info,
      ),
    120,
  );
  const assets = new Map<string, EditorialMediaAsset>();
  for (const item of candidates) {
    const imageUrl = safeHttpUrl(
      firstString(item, ["media_url_https", "media_url", "image_url"]),
    );
    if (imageUrl && !/profile_images/i.test(imageUrl)) {
      const url = imageUrl.includes("pbs.twimg.com/media")
        ? `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}name=large`
        : imageUrl;
      assets.set(url, {
        id: `x-image-${assets.size + 1}`,
        kind: "image",
        url,
        alt: "X原帖中的图片",
        sourceUrl,
      });
    }

    const videoInfo = record(item.video_info ?? item.videoInfo);
    const variants = Array.isArray(videoInfo.variants)
      ? videoInfo.variants.map(record)
      : [];
    const bestVideo = variants
      .filter((variant) =>
        firstString(variant, ["content_type", "contentType"]).includes("mp4"),
      )
      .sort(
        (left, right) =>
          (firstNumber(right, ["bitrate"]) ?? 0) -
          (firstNumber(left, ["bitrate"]) ?? 0),
      )[0];
    const videoUrl = safeHttpUrl(firstString(bestVideo ?? {}, ["url"]));
    if (videoUrl) {
      assets.set(videoUrl, {
        id: `x-video-${assets.size + 1}`,
        kind: "video",
        url: videoUrl,
        previewUrl: imageUrl,
        alt: "X原帖中的视频",
        sourceUrl,
      });
    }
  }
  return [...assets.values()].slice(0, 8);
}

const valueFromPayload = (root: unknown, keys: string[]): string => {
  if (typeof root === "string") return cleanText(root);
  const candidates = collectCandidateObjects(
    root,
    (item) => Boolean(firstString(item, keys)),
    30,
  );
  for (const item of candidates) {
    const value = firstString(item, keys);
    if (value) return cleanText(value);
  }
  return "";
};

function youtubeCaptionLanguages(root: unknown): string[] {
  const candidates = collectCandidateObjects(
    root,
    (item) =>
      Boolean(firstString(item, ["language_code", "languageCode", "vss_id"])),
    80,
  );
  return [
    ...new Set(
      candidates
        .map((item) =>
          firstString(item, ["language_code", "languageCode", "vss_id"])
            .replace(/^\./, "")
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function chooseCaptionLanguage(
  languages: string[],
  videoLanguage: string,
): string | undefined {
  const normalizedVideoLanguage = videoLanguage.toLowerCase();
  return (
    languages.find(
      (language) => language.toLowerCase() === normalizedVideoLanguage,
    ) ||
    languages.find((language) => /^zh(?:-|$)/i.test(language)) ||
    languages.find((language) => /^en(?:-|$)/i.test(language)) ||
    languages.find((language) => /^a\.en$/i.test(language)) ||
    languages[0]
  );
}

function youtubeChapters(root: unknown): string[] {
  const candidates = collectCandidateObjects(
    root,
    (item) =>
      Boolean(
        firstString(item, ["title"]) &&
          (item.start_time !== undefined ||
            item.startTime !== undefined ||
            item.start_time_seconds !== undefined),
      ),
    80,
  );
  return candidates
    .map((item) => {
      const title = firstString(item, ["title"]);
      const start = firstNumber(item, [
        "start_time",
        "startTime",
        "start_time_seconds",
      ]);
      if (!title) return "";
      if (start === undefined) return title;
      const seconds = Math.max(0, Math.round(start));
      const minutes = Math.floor(seconds / 60);
      const remainder = String(seconds % 60).padStart(2, "0");
      return `${minutes}:${remainder} ${title}`;
    })
    .filter(Boolean)
    .slice(0, 30);
}

function youtubeThumbnailAssets(
  root: unknown,
  sourceUrl: string,
): EditorialMediaAsset[] {
  const candidates = collectCandidateObjects(
    root,
    (item) =>
      Boolean(
        item.thumbnail_url ||
          item.thumbnailUrl ||
          (item.url &&
            typeof item.url === "string" &&
            /ytimg\.com|ggpht\.com/i.test(item.url)),
      ),
    80,
  );
  const ranked = candidates
    .map((item) => ({
      url: safeHttpUrl(
        firstString(item, ["thumbnail_url", "thumbnailUrl", "url"]),
      ),
      area:
        (firstNumber(item, ["width"]) ?? 0) *
        (firstNumber(item, ["height"]) ?? 0),
    }))
    .filter((item): item is { url: string; area: number } => Boolean(item.url))
    .sort((left, right) => right.area - left.area);
  const unique = [...new Map(ranked.map((item) => [item.url, item])).values()];
  return unique.slice(0, 2).map((item, index) => ({
    id: `youtube-thumbnail-${index + 1}`,
    kind: "thumbnail",
    url: item.url,
    alt: "YouTube视频封面",
    sourceUrl,
  }));
}

function githubPreviewAssets(item: ContentItem): EditorialMediaAsset[] {
  try {
    const url = new URL(item.url);
    if (url.hostname.toLowerCase() !== "github.com") return [];
    const [owner, repository] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repository) return [];
    const repoPath = `${owner}/${repository.replace(/\.git$/i, "")}`;
    return [
      {
        id: "github-project-preview",
        kind: "thumbnail",
        url: `https://opengraph.githubassets.com/1/${repoPath}`,
        alt: `${item.title}项目仓库预览`,
        sourceUrl: item.url,
      },
    ];
  } catch {
    return [];
  }
}

function captionContent(root: unknown): string {
  if (typeof root === "string") return cleanText(root, MAX_TRANSCRIPT_TEXT);
  const direct = record(root);
  for (const key of ["content", "transcript", "text", "subtitle"]) {
    if (typeof direct[key] === "string") {
      return cleanText(direct[key], MAX_TRANSCRIPT_TEXT);
    }
  }
  const items = collectCandidateObjects(
    root,
    (item) => Boolean(firstString(item, ["text", "utf8"])),
    2_000,
  );
  return cleanText(
    items.map((item) => firstString(item, ["text", "utf8"])).join("\n"),
    MAX_TRANSCRIPT_TEXT,
  );
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function enrichX(
  item: ContentItem,
  env: AppEnv,
): Promise<EditorialSourceBundle> {
  const warnings: string[] = [];
  const requestIds: string[] = [];
  if (!env.TIKHUB_TOKEN) {
    warnings.push("未配置可用的TikHub API Key，本次仅使用采集时保存的X正文。");
    return {
      contentId: item.id,
      platform: "x",
      fullText: item.body,
      thread: [],
      media: [],
      chapters: [],
      warnings,
      requestIds,
      enrichedAt: new Date().toISOString(),
    };
  }

  let detailData: unknown = null;
  let commentsData: unknown = null;
  try {
    const detail = await requestTikHub(
      env,
      "/api/v1/twitter/web/fetch_tweet_detail",
      { tweet_id: item.externalId },
    );
    detailData = detail.data;
    if (detail.request_id) requestIds.push(detail.request_id);
  } catch (error) {
    warnings.push(
      `X帖子详情获取失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
  try {
    const comments = await requestTikHub(
      env,
      "/api/v1/twitter/web/fetch_post_comments",
      { tweet_id: item.externalId },
    );
    commentsData = comments.data;
    if (comments.request_id) requestIds.push(comments.request_id);
  } catch (error) {
    warnings.push(
      `X串文回复获取失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  const detailTweets = extractTweetItems(detailData);
  const commentTweets = extractTweetItems(commentsData);
  const primary =
    detailTweets.find((tweet) => tweet.id === item.externalId) ||
    detailTweets[0];
  const primaryHandle = normalizedHandle(
    primary?.authorHandle || item.authorHandle,
  );
  const thread = [...detailTweets, ...commentTweets]
    .filter((tweet) => tweet.id !== item.externalId)
    .filter((tweet) => {
      const handle = normalizedHandle(tweet.authorHandle);
      return primaryHandle
        ? handle === primaryHandle
        : tweet.authorName === item.authorName;
    })
    .sort((left, right) =>
      String(left.publishedAt ?? "").localeCompare(String(right.publishedAt ?? "")),
    )
    .slice(0, 16)
    .map((tweet) => ({ ...tweet, kind: "thread" as const }));
  const primaryText = cleanText(primary?.text || item.body, 20_000);
  const fullText = cleanText(
    [primaryText, ...thread.map((tweet) => tweet.text)].filter(Boolean).join("\n\n"),
  );
  const media = mediaAssetsFromX({ detailData, commentsData }, item.url);
  if (!thread.length) warnings.push("未发现同作者的连续串文。");
  if (!media.length) warnings.push("原帖返回数据中没有可用图片或视频。");
  return {
    contentId: item.id,
    platform: "x",
    fullText: fullText || item.body,
    thread,
    media,
    chapters: [],
    warnings,
    requestIds,
    enrichedAt: new Date().toISOString(),
  };
}

async function enrichYouTube(
  item: ContentItem,
  env: AppEnv,
): Promise<EditorialSourceBundle> {
  const warnings: string[] = [];
  const requestIds: string[] = [];
  if (!env.TIKHUB_TOKEN) {
    warnings.push("未配置可用的TikHub API Key，本次仅使用采集时保存的YouTube简介。");
    return {
      contentId: item.id,
      platform: "youtube",
      fullText: item.body,
      description: item.body,
      thread: [],
      media: [],
      chapters: [],
      warnings,
      requestIds,
      enrichedAt: new Date().toISOString(),
    };
  }

  let infoData: unknown = null;
  try {
    const info = await requestTikHub(
      env,
      "/api/v1/youtube/web_v2/get_video_info_v2",
      { video_id: item.externalId, need_format: true },
    );
    infoData = info.data;
    if (info.request_id) requestIds.push(info.request_id);
  } catch (error) {
    warnings.push(
      `YouTube视频详情获取失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  const description =
    valueFromPayload(infoData, ["description", "short_description"]) ||
    item.body;
  const videoLanguage = valueFromPayload(infoData, ["language", "lang"]);
  let languages = youtubeCaptionLanguages(infoData);
  if (!languages.length) {
    try {
      const captionList = await requestTikHub(
        env,
        "/api/v1/youtube/web_v2/get_video_captions",
        { video_id: item.externalId },
      );
      if (captionList.request_id) requestIds.push(captionList.request_id);
      languages = youtubeCaptionLanguages(captionList.data);
    } catch (error) {
      warnings.push(
        `YouTube字幕列表获取失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  const transcriptLanguage = chooseCaptionLanguage(languages, videoLanguage);
  let transcript = "";
  if (transcriptLanguage) {
    try {
      let captionResponse = await requestTikHub(
        env,
        "/api/v1/youtube/web_v2/get_video_captions",
        {
          video_id: item.externalId,
          language_code: transcriptLanguage,
          format: "txt",
        },
      );
      if (captionResponse.request_id) requestIds.push(captionResponse.request_id);
      let captionData = record(captionResponse.data);
      const jobId = firstString(captionData, ["job_id", "jobId"]);
      if (
        jobId &&
        ["processing", "queued", "active"].includes(
          firstString(captionData, ["status"]).toLowerCase(),
        )
      ) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await delay(2_000);
          captionResponse = await requestTikHub(
            env,
            "/api/v1/youtube/web_v2/get_video_captions_result",
            { job_id: jobId, format: "txt" },
          );
          if (captionResponse.request_id) requestIds.push(captionResponse.request_id);
          captionData = record(captionResponse.data);
          if (firstString(captionData, ["status"]).toLowerCase() === "completed") {
            break;
          }
        }
      }
      transcript = captionContent(captionResponse.data);
    } catch (error) {
      warnings.push(
        `YouTube字幕内容获取失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  } else {
    warnings.push("该YouTube视频没有返回可用字幕，不会根据标题猜测视频内容。");
  }
  if (!transcript && transcriptLanguage) {
    warnings.push("已找到字幕语言，但字幕正文为空，发布前需人工核对。");
  }

  const chapters = youtubeChapters(infoData);
  const media = youtubeThumbnailAssets(infoData, item.url);
  const fullText = cleanText(
    [
      description ? `视频简介\n${description}` : "",
      chapters.length ? `视频章节\n${chapters.join("\n")}` : "",
      transcript ? `视频字幕\n${transcript}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  return {
    contentId: item.id,
    platform: "youtube",
    fullText: fullText || item.body,
    description,
    transcript: transcript || undefined,
    transcriptLanguage,
    thread: [],
    media,
    chapters,
    warnings,
    requestIds: [...new Set(requestIds)],
    enrichedAt: new Date().toISOString(),
  };
}

export async function enrichEditorialSource(
  item: ContentItem,
  env: AppEnv,
): Promise<EditorialSourceBundle> {
  if (item.platform === "x") return enrichX(item, env);
  if (item.platform === "youtube") return enrichYouTube(item, env);
  const media = item.platform === "github" ? githubPreviewAssets(item) : [];
  return {
    contentId: item.id,
    platform: item.platform,
    fullText: cleanText(item.body || item.aiSummary || item.title),
    thread: [],
    media,
    chapters: [],
    warnings: [],
    requestIds: [],
    enrichedAt: new Date().toISOString(),
  };
}

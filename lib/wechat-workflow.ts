import type { AppEnv } from "@/db/runtime";
import { getContentReview } from "@/db/repository";
import { addWechatLog, finishWechatOperation, getWechatDraft, lockWechatDraft, saveWechatDraft, WechatError } from "@/db/wechat";
import { articleFields, articleImages, contentHash, renderWechatHtml, validateWechatArticle, WECHAT_WRITING_VERSION, type WechatArticle } from "./wechat-content";
import { coverCrop, getWechatToken, readWechatImage, uploadWechatImage, WechatApiError, wechatRequest } from "./wechat";
import { generateWechatArticle } from "./wechat-writing";

export async function generateWechatVersion(contentId: string, version: number, env: AppEnv) {
  const review = await getContentReview(contentId);
  if (!review) throw new WechatError("知识库稿件不存在", 404);
  if (!review.editorContent.trim()) throw new WechatError("请先保存知识库正文，再生成公众号版");
  const { draft, token } = await lockWechatDraft(contentId, version, "generating");
  try {
    const article = await generateWechatArticle(review, env);
    Object.assign(draft, article, {
      sourceHash: await contentHash([review.editorTitle, review.editorContent]),
      profileVersion: WECHAT_WRITING_VERSION, status: "draft",
      message: article.coverUrl ? "公众号版已另存，请检查正文与封面后发送草稿箱" : "公众号版已另存，请补充真实配图和封面后发送",
    });
    await finishWechatOperation(draft, token);
  } catch (error) {
    draft.message = error instanceof WechatError ? error.message : "公众号版生成失败，已有稿件未覆盖";
    // Existing article and previous sync state are retained on failure.
    await finishWechatOperation(draft, token);
    throw error;
  }
  return getWechatDraft(contentId);
}

export async function editWechatVersion(contentId: string, version: number, article: WechatArticle) {
  const draft = await getWechatDraft(contentId);
  if (!draft.version) throw new WechatError("请先生成公众号版");
  if (draft.version !== version || draft.operation) throw new WechatError("稿件已变化或正在处理，请刷新后再保存", 409);
  const fields = articleFields(article);
  const errors = validateWechatArticle(fields);
  if (errors.length) throw new WechatError(errors.join("；"));
  return saveWechatDraft({ ...draft, ...fields,
    status: draft.status === "unknown" ? "unknown" : await contentHash(fields) === draft.syncedHash ? "synced" : "draft",
    message: "公众号稿件已保存；知识库原稿未改变",
  });
}

export async function syncWechatVersion(contentId: string, version: number, env: AppEnv) {
  const { draft, token } = await lockWechatDraft(contentId, version, "syncing");
  let committing = false;
  try {
    const errors = validateWechatArticle(draft, true);
    if (errors.length) throw new WechatError(errors.join("；"));
    const accountId = env.WECHAT_APP_ID?.trim() || "";
    if (draft.mediaId && draft.accountId !== accountId) throw new WechatError("这篇稿件绑定了另一个公众号，请恢复原账号配置后操作", 409);
    const accessToken = await getWechatToken(env);
    if (draft.accountId !== accountId) {
      draft.accountId = accountId; draft.imageCache = {}; draft.coverMediaId = ""; draft.uploadedCoverUrl = "";
    }
    const hash = await contentHash(articleFields(draft));
    if (draft.mediaId) {
      // Do not update a published/deleted draft or accidentally overwrite a
      // multi-article message that was regrouped in WeChat's editor.
      const remote = await wechatRequest("draft/get", { media_id: draft.mediaId }, accessToken);
      if (!Array.isArray(remote.news_item) || remote.news_item.length !== 1) throw new WechatError("微信后台稿件已改变，请在后台检查后再同步", 409);
      if (draft.syncedHash === hash) {
        draft.status = "synced"; draft.message = "内容没有变化，已确认草稿仍在微信后台；未重复创建";
        await finishWechatOperation(draft, token);
        await addWechatLog(contentId, "unchanged", draft.message, draft.mediaId).catch(() => {});
        return getWechatDraft(contentId);
      }
    }
    draft.message = "正在上传正文配图";
    await finishWechatOperation(draft, token, false);
    const urls = [...new Set(articleImages(draft.bodyMarkdown).map((image) => image.url))];
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index];
      if (!draft.imageCache[url]) {
        draft.imageCache[url] = await uploadWechatImage(await readWechatImage(url, env), accessToken);
      }
      draft.message = `正文图片 ${index + 1}/${urls.length} 已上传`;
      await finishWechatOperation(draft, token, false);
    }
    draft.message = "正在处理封面";
    await finishWechatOperation(draft, token, false);
    const cover = await readWechatImage(draft.coverUrl, env);
    if (!draft.coverMediaId || draft.uploadedCoverUrl !== draft.coverUrl) {
      draft.coverMediaId = await uploadWechatImage(cover, accessToken, true);
      draft.uploadedCoverUrl = draft.coverUrl;
      await finishWechatOperation(draft, token, false);
    }
    const html = renderWechatHtml(draft.bodyMarkdown, draft.imageCache);
    if (html.length >= 20_000 || new TextEncoder().encode(html).byteLength >= 1_000_000) throw new WechatError("上传图片后的正文超过微信长度限制，请拆篇后同步");
    const article = {
      article_type: "news", title: draft.title, digest: draft.digest, author: draft.author,
      content: html, thumb_media_id: draft.coverMediaId, need_open_comment: 0,
      only_fans_can_comment: 0, cover_info: coverCrop(cover.width, cover.height),
    };
    draft.message = draft.mediaId ? "正在更新微信已有草稿" : "正在创建微信草稿";
    await finishWechatOperation(draft, token, false);
    committing = true;
    const result = draft.mediaId
      ? await wechatRequest("draft/update", { media_id: draft.mediaId, index: 0, articles: article }, accessToken)
      : await wechatRequest("draft/add", { articles: [article] }, accessToken);
    if (draft.mediaId && result.errcode !== 0) throw new WechatError("微信未确认草稿更新结果，请先检查后台", 502);
    if (!draft.mediaId) {
      if (typeof result.media_id !== "string" || !result.media_id) throw new WechatError("微信未返回草稿 ID，请先检查后台再重试", 502);
      draft.mediaId = result.media_id;
    }
    draft.status = "synced"; draft.syncedHash = hash; draft.syncedAt = new Date().toISOString();
    draft.message = "已保存到公众号草稿箱，尚未发布。请前往微信后台预览并确认发布。";
    await finishWechatOperation(draft, token);
  } catch (error) {
    draft.status = committing && !(error instanceof WechatApiError) ? "unknown" : "failed";
    const message = error instanceof WechatError ? error.message : "操作失败，请稍后检查状态";
    draft.message = draft.status === "unknown" ? `${message}；结果不明，已禁止自动重发，请先检查公众号草稿箱` : message;
    await finishWechatOperation(draft, token);
    await addWechatLog(contentId, draft.status, draft.message, draft.mediaId);
    throw new WechatError(draft.message, error instanceof WechatError ? error.statusCode : 502);
  }
  // Keep audit-log failure separate from the actual remote commit result.
  await addWechatLog(contentId, "synced", draft.message, draft.mediaId).catch(() => {});
  return getWechatDraft(contentId);
}

export async function reconcileWechatVersion(contentId: string, version: number, mediaId: string, confirmNoRemoteDraft: boolean, env: AppEnv) {
  const draft = await getWechatDraft(contentId);
  if (draft.version !== version || draft.operation) throw new WechatError("稿件已变化，请刷新", 409);
  if (draft.status !== "unknown" && draft.status !== "failed") throw new WechatError("当前不需要恢复同步状态", 409);
  if (mediaId) {
    if (mediaId.length > 256) throw new WechatError("草稿 ID 无效");
    const remote = await wechatRequest("draft/get", { media_id: mediaId }, await getWechatToken(env));
    const items = remote.news_item as Array<{ title?: string }> | undefined;
    if (!Array.isArray(items) || items.length !== 1 || items[0].title !== draft.title) throw new WechatError("草稿标题或篇数不匹配，未绑定，请核对 ID");
    if (draft.accountId !== env.WECHAT_APP_ID!.trim()) {
      draft.imageCache = {}; draft.coverMediaId = ""; draft.uploadedCoverUrl = "";
    }
    draft.mediaId = mediaId; draft.accountId = env.WECHAT_APP_ID!.trim();
    draft.message = "已绑定后台草稿，再次发送会更新该草稿，不会新增";
  } else if (confirmNoRemoteDraft) {
    draft.mediaId = ""; draft.message = "已按你的确认解除同步保护；下次发送会创建新草稿";
  } else throw new WechatError("请填写已找到的草稿 ID，或明确确认后台没有这篇草稿");
  draft.status = "draft"; draft.syncedHash = "";
  const result = await saveWechatDraft(draft);
  await addWechatLog(contentId, "reconciled", draft.message, draft.mediaId);
  return result;
}

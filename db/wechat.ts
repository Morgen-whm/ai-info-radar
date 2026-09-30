import { getDatabase } from "./repository";
import { ensureDatabase } from "./runtime";
import { blankWechatDraft, type WechatDraft, type WechatSyncLog } from "@/lib/wechat-content";

export class WechatError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

async function database() {
  const db = await getDatabase();
  await ensureDatabase(db);
  return db;
}

export async function getWechatDraft(contentId: string): Promise<WechatDraft> {
  const db = await database();
  // A crashed worker must never leave an endless spinner or blindly repeat a
  // possibly committed draft/add request. Recover conservatively after 10 min.
  const stale = new Date(Date.now() - 600_000).toISOString();
  await db.prepare(`UPDATE wechat_drafts SET
    data_json = json_set(data_json, '$.status', CASE WHEN operation = 'syncing' THEN 'unknown' ELSE 'failed' END,
      '$.message', '任务连接已中断。同步结果不明时，请先在公众号草稿箱检查，勿直接重复发送。'),
    operation = '', operation_token = '', operation_started_at = NULL, version = version + 1
    WHERE content_id = ? AND operation != '' AND updated_at < ?`).bind(contentId, stale).run();
  const row = await db.prepare("SELECT * FROM wechat_drafts WHERE content_id = ?").bind(contentId).first<Record<string, unknown>>();
  if (!row) return blankWechatDraft(contentId);
  return {
    ...blankWechatDraft(contentId), ...JSON.parse(String(row.data_json)), contentId,
    version: Number(row.version), operation: row.operation as WechatDraft["operation"],
    operationStartedAt: row.operation_started_at ? String(row.operation_started_at) : null,
    updatedAt: String(row.updated_at),
  };
}

export async function lockWechatDraft(contentId: string, version: number, operation: "generating" | "syncing") {
  const db = await database();
  const draft = await getWechatDraft(contentId);
  if (draft.operation || draft.version !== version) throw new WechatError("稿件已变化或正在处理，请刷新后再试", 409);
  if (draft.status === "unknown") throw new WechatError("上次同步结果不明，请先核对公众号草稿箱", 409);
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO wechat_drafts
    (content_id, data_json, version, operation, operation_token, updated_at) VALUES (?, ?, 0, '', '', ?)`)
    .bind(contentId, JSON.stringify(draft), now).run();
  const token = crypto.randomUUID();
  const locked = await db.prepare(`UPDATE wechat_drafts SET operation = ?, operation_token = ?, operation_started_at = ?, updated_at = ?, version = version + 1
    WHERE content_id = ? AND version = ? AND operation = ''`).bind(operation, token, now, now, contentId, version).run();
  if (!locked.meta.changes) throw new WechatError("已有其他操作正在处理这篇稿件", 409);
  return { draft: { ...draft, version: version + 1, operation }, token };
}

export async function finishWechatOperation(draft: WechatDraft, token: string, release = true) {
  const db = await database();
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE wechat_drafts SET data_json = ?, updated_at = ?,
    operation = CASE WHEN ? THEN '' ELSE operation END,
    operation_token = CASE WHEN ? THEN '' ELSE operation_token END,
    operation_started_at = CASE WHEN ? THEN NULL ELSE operation_started_at END,
    version = version + 1 WHERE content_id = ? AND operation_token = ?`)
    .bind(JSON.stringify(draft), now, release ? 1 : 0, release ? 1 : 0, release ? 1 : 0, draft.contentId, token).run();
  if (!result.meta.changes) throw new WechatError("任务锁已失效，请刷新检查结果", 409);
}

export async function saveWechatDraft(draft: WechatDraft) {
  const db = await database();
  const result = await db.prepare(`UPDATE wechat_drafts SET data_json = ?, updated_at = ?, version = version + 1
    WHERE content_id = ? AND version = ? AND operation = ''`)
    .bind(JSON.stringify(draft), new Date().toISOString(), draft.contentId, draft.version).run();
  if (!result.meta.changes) throw new WechatError("稿件已被其他窗口更新，请刷新后再保存", 409);
  return getWechatDraft(draft.contentId);
}

export async function addWechatLog(contentId: string, status: string, message: string, mediaId = "") {
  const db = await database();
  await db.prepare(`INSERT INTO wechat_sync_logs (id, content_id, status, message, media_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), contentId, status, message, mediaId, new Date().toISOString()).run();
}
export async function listWechatLogs(contentId: string): Promise<WechatSyncLog[]> {
  const db = await database();
  const rows = await db.prepare(`SELECT id, status, message, media_id AS mediaId, created_at AS createdAt
    FROM wechat_sync_logs WHERE content_id = ? ORDER BY created_at DESC LIMIT 15`).bind(contentId).all<WechatSyncLog>();
  return rows.results;
}

export async function saveWechatAsset(id: string, mime: string, data: string) {
  const db = await database();
  await db.prepare("INSERT INTO wechat_assets (id, mime, data_base64, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, mime, data, new Date().toISOString()).run();
}
export async function getWechatAsset(id: string) {
  const db = await database();
  return db.prepare("SELECT mime, data_base64 AS data FROM wechat_assets WHERE id = ?")
    .bind(id).first<{ mime: string; data: string }>();
}

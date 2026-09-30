"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentReview } from "@/lib/types";
import {
  articleFields, articleImages, blankWechatDraft, contentHash, renderWechatHtml,
  validateWechatArticle, type WechatArticle, type WechatConfigStatus, type WechatDraft, type WechatSyncLog,
} from "@/lib/wechat-content";

export function WechatDraftPanel({ review, config: initialConfig, onDirtyChange, onBusyChange }: {
  review: ContentReview;
  config: WechatConfigStatus;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<WechatDraft>(() => blankWechatDraft(review.contentId));
  const [form, setForm] = useState<WechatArticle>(() => articleFields(blankWechatDraft(review.contentId)));
  const [logs, setLogs] = useState<WechatSyncLog[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sourceHash, setSourceHash] = useState("");
  const [recoveryId, setRecoveryId] = useState("");
  const [noRemote, setNoRemote] = useState(false);
  const dirty = JSON.stringify(articleFields(form)) !== JSON.stringify(articleFields(draft));
  const dirtyRef = useRef(dirty);
  const latestVersion = useRef(0);
  const active = Boolean(busy || draft.operation || loading);
  const path = `/api/reviews/${encodeURIComponent(review.contentId)}/wechat`;
  const issues = useMemo(() => validateWechatArticle(form, true), [form]);
  const images = useMemo(() => [...new Set(articleImages(form.bodyMarkdown).map((image) => image.url))], [form.bodyMarkdown]);

  useEffect(() => { dirtyRef.current = dirty; onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(active); }, [active, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    let current = true;
    void contentHash([review.editorTitle, review.editorContent]).then((hash) => { if (current) setSourceHash(hash); });
    return () => { current = false; };
  }, [review.editorTitle, review.editorContent]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(path, { cache: "no-store", signal });
    const data = await response.json() as { draft: WechatDraft; logs: WechatSyncLog[]; config: WechatConfigStatus; error?: string };
    if (!response.ok || !data.draft) throw new Error(data.error || "公众号稿件加载失败");
    if (data.draft.version < latestVersion.current) return data.draft;
    latestVersion.current = data.draft.version;
    setDraft(data.draft); setLogs(data.logs || []); setConfig(data.config);
    if (!dirtyRef.current) setForm(articleFields(data.draft));
    return data.draft as WechatDraft;
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((error: Error) => {
      if (!controller.signal.aborted) setNotice(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!busy && !draft.operation) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try { await reload(controller.signal); } catch { /* Next poll or action error provides recovery. */ }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [busy, draft.operation, reload]);

  function change(patch: Partial<WechatArticle>) { setForm((current) => ({ ...current, ...patch })); setConfirmed(false); }

  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (active) return;
    if (name === "generate" && (dirty || draft.bodyMarkdown) && !window.confirm("重新生成只替换公众号稿件，知识库原稿不变。是否继续？")) return;
    if (name === "sync" && !window.confirm(draft.mediaId
      ? "更新微信已有草稿？这会覆盖该草稿在微信后台的手动编辑，但不会正式发布。"
      : "把当前公众号稿件及图片发送到公众号草稿箱？不会正式发布。")) return;
    setBusy(name); setNotice("");
    try {
      const response = await fetch(path, {
        method: name === "save" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: draft.version, action: name, ...(name === "save" ? articleFields(form) : {}), reviewConfirmed: confirmed, ...extra }),
        signal: AbortSignal.timeout(name === "generate" ? 210_000 : 540_000),
      });
      const data = await response.json() as { draft: WechatDraft; logs?: WechatSyncLog[]; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "公众号操作失败");
      dirtyRef.current = false;
      latestVersion.current = data.draft.version;
      setDraft(data.draft); setForm(articleFields(data.draft));
      if (data.logs) setLogs(data.logs);
      setNotice(data.draft.message); setConfirmed(false);
    } catch (error) {
      setNotice(error instanceof Error && error.name !== "TimeoutError" ? error.message : "请求连接中断，正在检查服务端状态；请勿重复发送");
      await reload().catch(() => {});
    } finally { setBusy(""); }
  }

  async function upload(file: File | undefined, target: "cover" | "body") {
    if (!file || active) return;
    if (file.size >= 1_000_000) { setNotice("图片需小于 1 MB，请压缩成清晰的 JPG / PNG 后上传"); return; }
    setBusy("upload"); setNotice("");
    try {
      const data = new FormData(); data.append("image", file);
      const response = await fetch("/api/wechat/assets", { method: "POST", body: data, signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as { url: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "图片上传失败");
      if (target === "cover") change({ coverUrl: result.url });
      else change({ bodyMarkdown: `${form.bodyMarkdown.trim()}\n\n![${file.name.replace(/[\[\]<>]/g, "").replace(/\.[^.]+$/, "")}](${result.url})\n` });
      setNotice(target === "cover" ? "封面已上传，请保存公众号稿" : "图片已加到正文末尾，可移动到对应段落；请保存公众号稿");
    } catch (error) { setNotice(error instanceof Error ? error.message : "图片上传失败"); }
    finally { setBusy(""); }
  }

  const status = draft.operation === "generating" || busy === "generate" ? "正在生成" : draft.operation === "syncing" || busy === "sync" ? "正在同步" : draft.status === "synced" ? "已存草稿 · 未发布" : draft.status === "unknown" ? "同步结果待核对" : draft.status === "failed" ? "上次同步失败" : draft.bodyMarkdown ? "待人工预览" : "尚未生成";
  const previewDocument = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http://localhost:* http://127.0.0.1:*; style-src 'unsafe-inline'"><style>body{margin:0;padding:24px 18px;background:white;font-family:system-ui,sans-serif;color:#242424}img{max-width:100%}pre{font-size:13px}</style></head><body>${renderWechatHtml(form.bodyMarkdown)}</body></html>`;

  return (
    <section id="wechat-draft" className="panel wechat-panel" aria-labelledby="wechat-heading">
      <header className="wechat-heading">
        <div><span className="section-eyebrow">WECHAT DRAFT STUDIO</span><h2 id="wechat-heading">公众号稿件</h2><p>当前文章：{review.editorTitle || review.source.title}</p><p>知识库原稿保留。公众号稿独立编辑，发送后仍需在微信后台预览、确认发布。</p></div>
        <span className="credential-status">{status}</span>
      </header>
      {!config.configured || !config.aiConfigured ? <div className="wechat-hint">
        {!config.configured ? <p>{config.message} <a href="/settings#wechat-settings">查看配置说明</a></p> : null}
        {!config.aiConfigured ? <p>生成公众号版需要现有 DeepSeek / AI 写作配置。已有稿件的编辑与同步不依赖模型。</p> : null}
      </div> : null}
      <div className="wechat-toolbar">
        <button type="button" className="button button-primary" onClick={() => void action("generate")} disabled={active || !config.aiConfigured || !review.editorContent.trim()}>{busy === "generate" ? "生成中，请稍候…" : draft.bodyMarkdown ? "重新生成公众号版" : "生成公众号版"}</button>
        <small>基于已保存的知识库稿件生成；若刚改过上方正文，请先点“保存”。</small>
        <button type="button" className="button button-secondary" disabled={active || dirty} onClick={() => { setLoading(true); void reload().catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false)); }}>刷新状态</button>
      </div>
      {draft.sourceHash && sourceHash && draft.sourceHash !== sourceHash ? <p className="wechat-hint">知识库稿件已变化。当前公众号稿仍保留生成时的内容，不会被自动覆盖。</p> : null}
      {draft.operation ? <p role="status" className="wechat-hint">{draft.message || "正在处理，请稍候"}（刷新页面也可继续查看状态）</p> : null}
      {draft.bodyMarkdown ? <>
        <div className="wechat-layout">
          <fieldset className="wechat-form" disabled={active}>
            <label>公众号标题 <small>{Array.from(form.title).length}/32</small><input value={form.title} onChange={(event) => change({ title: event.target.value })} maxLength={64} /></label>
            <label>摘要 <small>{Array.from(form.digest).length}/120</small><textarea rows={3} value={form.digest} onChange={(event) => change({ digest: event.target.value })} maxLength={240} /></label>
            <label>作者署名（可选）<input value={form.author} onChange={(event) => change({ author: event.target.value })} maxLength={32} placeholder="你的知识库 / 公众号署名" /></label>
            <label>封面图片地址<input value={form.coverUrl} onChange={(event) => change({ coverUrl: event.target.value })} placeholder="选择下方配图，或上传本地图片" /></label>
            <label>上传封面（JPG / PNG，小于 1 MB）<input type="file" accept="image/jpeg,image/png" onChange={(event) => { void upload(event.target.files?.[0], "cover"); event.target.value = ""; }} /></label>
            {images.length ? <div className="wechat-image-choices" aria-label="从正文选择封面">{images.map((url, index) => <button type="button" key={url} onClick={() => change({ coverUrl: url })} aria-pressed={form.coverUrl === url} title={`使用第 ${index + 1} 张正文图片作为封面`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`正文配图 ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
            </button>)}</div> : null}
            <div className="wechat-toolbar"><strong>公众号正文 · Markdown</strong><button type="button" onClick={() => setPreview(!preview)} className="button button-secondary">{preview ? "返回编辑" : "手机排版预览"}</button></div>
            {!preview ? <label><span className="sr-only">公众号正文</span><textarea className="wechat-body" value={form.bodyMarkdown} onChange={(event) => change({ bodyMarkdown: event.target.value })} spellCheck={false} /></label> : <iframe title="公众号手机正文预览" className="wechat-preview" sandbox="" srcDoc={previewDocument} />}
            <label>添加正文配图（上传后插入末尾，可调整位置）<input type="file" accept="image/jpeg,image/png" onChange={(event) => { void upload(event.target.files?.[0], "body"); event.target.value = ""; }} /></label>
          </fieldset>
          <aside className="wechat-delivery">
            <h3>草稿卡片预览</h3>
            {form.coverUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wechat-cover" src={form.coverUrl} alt="公众号封面预览" referrerPolicy="no-referrer" />
            </> : <div className="wechat-cover-empty">请补充真实封面</div>}
            <strong>{form.title}</strong><p>{form.digest}</p>
            <small>封面按 2.35:1 居中裁切，最终以微信后台预览为准。</small>
            {issues.length ? <div className="wechat-hint"><strong>发送前还需处理</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
            <label className="wechat-confirm"><input type="checkbox" checked={confirmed} disabled={active || dirty} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已检查正文、封面和图片使用权，确认只发送草稿箱；正式发布前在微信后台检查所需声明及标识。</span></label>
            <button type="button" className="button button-secondary" disabled={active || !dirty} onClick={() => void action("save")}>{busy === "save" ? "保存中…" : "保存公众号稿"}</button>
            <button type="button" className="button button-primary" disabled={active || dirty || !confirmed || !config.configured || Boolean(issues.length) || draft.status === "unknown"} onClick={() => void action("sync")}>{busy === "sync" ? "正在上传图片并同步…" : draft.mediaId ? "更新公众号草稿" : "发送到公众号草稿箱"}</button>
            {dirty ? <small className="wechat-warning">有未保存的更改，请先保存再发送。</small> : null}
            <a href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer" className="button button-secondary">打开公众号后台预览</a>
            {draft.syncedAt ? <p>上次同步：{new Date(draft.syncedAt).toLocaleString("zh-CN")}</p> : null}
            {draft.mediaId ? <p className="wechat-media-id">草稿 ID：<code>{draft.mediaId}</code></p> : null}
            <small>不会自动发表、群发或声明原创。微信后台手动修改不会自动回流到本项目。</small>
          </aside>
        </div>
        {draft.status === "unknown" || draft.status === "failed" ? <details className="wechat-recovery" open={draft.status === "unknown"}>
          <summary>同步恢复：先核对微信草稿箱，避免重复文章</summary>
          <p>找到同标题草稿时填入草稿 ID 绑定；如果草稿已删除、已发布或确定未创建，请确认后解除保护。不会删除微信内容。</p>
          <label>已找到的草稿 ID<input value={recoveryId} onChange={(event) => setRecoveryId(event.target.value)} placeholder="可选：从微信草稿接口或管理工具获得的 media_id" /></label>
          <label className="wechat-confirm"><input type="checkbox" checked={noRemote} onChange={(event) => setNoRemote(event.target.checked)} />我已检查后台，确认没有需要保留关联的未发布草稿，允许下次新建。</label>
          <button type="button" className="button button-secondary" disabled={active || dirty || (!recoveryId && !noRemote)} onClick={() => void action("reconcile", { mediaId: recoveryId, confirmNoRemoteDraft: noRemote })}>确认恢复同步</button>
        </details> : null}
      </> : <p className="wechat-empty">先在上方选择并保存知识库文章，再点击“生成公众号版”。标题、摘要、正文与封面将另存于此。</p>}
      {notice ? <p className="wechat-notice" role="status">{notice}</p> : null}
      {logs.length ? <details className="wechat-history"><summary>同步记录（最近 {logs.length} 次）</summary><ol>{logs.map((log) => <li key={log.id}><time>{new Date(log.createdAt).toLocaleString("zh-CN")}</time><span>{log.message}</span></li>)}</ol></details> : null}
    </section>
  );
}

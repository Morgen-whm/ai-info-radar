import { saveWechatAsset, WechatError } from "@/db/wechat";
import { privateJson, requireSameOrigin } from "@/lib/same-origin";
import { inspectWechatImage } from "@/lib/wechat";
import { WECHAT_ASSET_PREFIX } from "@/lib/wechat-content";

export async function POST(request: Request) {
  const forbidden = requireSameOrigin(request);
  if (forbidden) return forbidden;
  try {
    // Read a bounded multipart body before parsing, including chunked requests.
    if (!request.body) return privateJson({ error: "请选择图片" }, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1_100_000) throw new WechatError("图片需小于 1 MB", 413);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new WechatError("请选择图片文件");
    const image = new Uint8Array(await file.arrayBuffer());
    const info = inspectWechatImage(image);
    let binary = "";
    for (let i = 0; i < image.length; i += 8192) binary += String.fromCharCode(...image.subarray(i, i + 8192));
    const id = crypto.randomUUID();
    await saveWechatAsset(id, info.mime, btoa(binary));
    return privateJson({ url: `${WECHAT_ASSET_PREFIX}${id}`, ...info });
  } catch (error) {
    return privateJson({ error: error instanceof WechatError ? error.message : "图片上传失败" }, { status: error instanceof WechatError ? error.statusCode : 400 });
  }
}

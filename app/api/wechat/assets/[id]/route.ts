import { getWechatAsset } from "@/db/wechat";
import { privateJson } from "@/lib/same-origin";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return privateJson({ error: "图片不存在" }, { status: 404 });
  try {
    const image = await getWechatAsset(id);
    if (!image) return privateJson({ error: "图片不存在" }, { status: 404 });
    return new Response(Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0)), {
      headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
    });
  } catch { return privateJson({ error: "图片读取失败" }, { status: 503 }); }
}

import { getAppEnv } from "@/db/runtime";
import { getFeishuConfigStatus } from "@/lib/feishu";
import { privateJson } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  return privateJson(getFeishuConfigStatus(await getAppEnv()));
}

import type { AppEnv } from "@/db/runtime";
import type { ConnectorResult, Source } from "../types";
import { fetchGitLabSource } from "./gitlab";
import { fetchIdcFlareSource } from "./idcflare";
import { fetchLinuxDoSource } from "./linuxdo";
import { fetchTikHubSource } from "./tikhub";

export async function fetchSource(
  source: Source,
  env: AppEnv,
  options: { feedContent?: string; linuxRssXml?: string } = {},
): Promise<ConnectorResult> {
  if (source.platform === "linuxdo") {
    return fetchLinuxDoSource(
      source,
      env,
      options.feedContent ?? options.linuxRssXml,
    );
  }
  if (source.platform === "idcflare") {
    return fetchIdcFlareSource(source, env, options.feedContent);
  }
  if (source.platform === "gitlab") {
    return fetchGitLabSource(source, env);
  }
  return fetchTikHubSource(source, env);
}

import type { Metadata } from "next";
import { demoSources } from "@/lib/demo-data";
import { SourceManager } from "./SourceManager";
import { listSources } from "@/db/repository";

export const metadata: Metadata = {
  title: "监测源",
};

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  let sources = demoSources;
  try {
    sources = await listSources();
  } catch {
    // The client will retry the source API after hydration.
  }
  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">SOURCE CONTROL</span>
          <h1>监测源</h1>
          <p>
            配置 X、YouTube、Linux.do、IDCFlare 与 GitLab
            的账号、频道、关键词和热点来源。
          </p>
        </div>
      </header>
      <SourceManager initialSources={sources} />
    </main>
  );
}

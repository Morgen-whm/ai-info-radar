import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/MarkdownArticle";
import { getKnowledgeArticleBySlug } from "@/db/repository";
import { getKnowledgeCategory } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const article = await getKnowledgeArticleBySlug(slug);
    return article
      ? {
          title: article.title,
          description: article.excerpt,
          alternates: { canonical: `/knowledge/${article.slug}` },
        }
      : { title: "文章不存在" };
  } catch {
    return { title: "知识文章" };
  }
}

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await getKnowledgeArticleBySlug(slug).catch(() => null);
  if (!article) notFound();
  const category = getKnowledgeCategory(article.category);
  const source = article.sourceSnapshot;

  return (
    <main className="knowledge-article-page">
      <Link href="/knowledge" className="knowledge-back-link">
        返回知识库
      </Link>
      <article>
        <header className="knowledge-article-hero">
          <div className="knowledge-article-meta">
            <Link href={`/knowledge?category=${article.category}`}>{category.label}</Link>
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          </div>
          <h1>{article.title}</h1>
          <p>{article.excerpt}</p>
        </header>

        <div className="knowledge-article-layout">
          <div className="knowledge-article-body">
            <MarkdownArticle markdown={article.bodyMarkdown} />
          </div>
          <aside className="knowledge-source-note">
            <span>来源说明</span>
            <p>本文经过重新组织和人工审核，观点与原始来源已尽量区分。</p>
            <dl>
              <div>
                <dt>原始平台</dt>
                <dd>{source.platform}</dd>
              </div>
              <div>
                <dt>原作者</dt>
                <dd>{source.authorName || "作者待核对"}</dd>
              </div>
              <div>
                <dt>原始发布时间</dt>
                <dd>{formatDate(source.publishedAt)}</dd>
              </div>
            </dl>
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              查看原始资料
            </a>
          </aside>
        </div>
      </article>
    </main>
  );
}

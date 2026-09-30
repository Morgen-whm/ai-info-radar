import type { Metadata } from "next";
import Link from "next/link";
import { listKnowledgeArticles } from "@/db/repository";
import {
  getKnowledgeCategory,
  isKnowledgeCategory,
  knowledgeCategories,
} from "@/lib/knowledge";
import type { KnowledgeArticle, KnowledgeCategory } from "@/lib/types";

export const metadata: Metadata = {
  title: "AI 实践知识库",
  description:
    "经过来源核对、重新组织和人工审核的 Codex、开源项目、海外实践与实测教程。",
};

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const params = await searchParams;
  const selectedCategory: KnowledgeCategory | "all" = isKnowledgeCategory(
    params.category,
  )
    ? params.category
    : "all";
  const query = params.q?.trim() || "";
  let articles: KnowledgeArticle[] = [];
  let databaseReady = true;
  try {
    articles = await listKnowledgeArticles({
      category: selectedCategory,
      query,
      limit: 120,
    });
  } catch {
    databaseReady = false;
  }

  return (
    <main className="knowledge-home">
      <section className="knowledge-intro">
        <span className="knowledge-kicker">CONTENT MAP</span>
        <h1>把一手信息，整理成真正能用的知识</h1>
        <p>
          每篇内容都经过来源核对、原创改写和人工审核。保留证据链接，不把未经验证的观点写成事实。
        </p>
        <div className="knowledge-intro-actions">
          <a href="#articles">浏览全部内容</a>
          <span>{articles.length} 篇已发布文章</span>
        </div>
      </section>

      <section className="knowledge-map" aria-labelledby="knowledge-map-title">
        <div className="knowledge-section-heading">
          <div>
            <h2 id="knowledge-map-title">你会在这里看到什么</h2>
            <p>围绕真实工作和学习价值整理，不追逐只有更新时间的低价值信息。</p>
          </div>
          {selectedCategory !== "all" || query ? (
            <Link href="/knowledge">清除筛选</Link>
          ) : null}
        </div>
        <div className="knowledge-category-grid">
          {knowledgeCategories.map((category) => (
            <Link
              key={category.id}
              href={`/knowledge?category=${category.id}#articles`}
              className={
                selectedCategory === category.id
                  ? `knowledge-category-card active category-${category.id}`
                  : `knowledge-category-card category-${category.id}`
              }
            >
              <span>{category.shortLabel}</span>
              <h3>{category.label}</h3>
              <p>{category.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="knowledge-articles" id="articles" aria-labelledby="articles-title">
        <div className="knowledge-section-heading knowledge-article-heading">
          <div>
            <h2 id="articles-title">
              {selectedCategory === "all"
                ? "最新知识"
                : getKnowledgeCategory(selectedCategory).label}
            </h2>
            <p>{query ? `搜索“${query}”的结果` : "按发布时间查看已经审核通过的内容。"}</p>
          </div>
          <form action="/knowledge" method="get" className="knowledge-search">
            {selectedCategory !== "all" ? (
              <input type="hidden" name="category" value={selectedCategory} />
            ) : null}
            <label htmlFor="knowledge-query">搜索知识库</label>
            <div>
              <input
                id="knowledge-query"
                name="q"
                defaultValue={query}
                placeholder="搜索 Codex、项目或教程"
              />
              <button type="submit">搜索</button>
            </div>
          </form>
        </div>

        {!databaseReady ? (
          <div className="knowledge-empty-state">
            <strong>知识库数据库暂不可用</strong>
            <p>请确认本地 D1 已启动，然后刷新页面。</p>
          </div>
        ) : articles.length ? (
          <div className="knowledge-article-grid">
            {articles.map((article, index) => {
              const category = getKnowledgeCategory(article.category);
              return (
                <article
                  className={index === 0 ? "knowledge-card featured" : "knowledge-card"}
                  key={article.id}
                >
                  <div className="knowledge-card-meta">
                    <span>{category.shortLabel}</span>
                    <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
                  </div>
                  <h3>
                    <Link href={`/knowledge/${article.slug}`}>{article.title}</Link>
                  </h3>
                  <p>{article.excerpt}</p>
                  <div className="knowledge-card-footer">
                    <span>{article.sourceSnapshot.sourceName || article.sourceSnapshot.platform}</span>
                    <Link href={`/knowledge/${article.slug}`}>阅读全文</Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-empty-state">
            <strong>{query ? "没有找到匹配文章" : "这个分类还没有发布内容"}</strong>
            <p>
              {query
                ? "尝试更换关键词，或清除当前分类筛选。"
                : "到审核中心完成原创改写并发布，文章会出现在这里。"}
            </p>
            <Link href={query ? "/knowledge" : "/review"}>
              {query ? "查看全部内容" : "前往审核中心"}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

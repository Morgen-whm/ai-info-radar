"use client";

import { useMemo, useState } from "react";
import { ContentCard } from "@/components/ContentCard";
import type { ContentItem, Platform } from "@/lib/types";
import { recommendationScore } from "@/lib/content-value";

const filters: Array<{ value: "all" | Platform; label: string }> = [
  { value: "all", label: "全部平台" },
  { value: "x", label: "X" },
  { value: "youtube", label: "YouTube" },
  { value: "linuxdo", label: "Linux.do" },
  { value: "idcflare", label: "IDCFlare" },
  { value: "gitlab", label: "GitLab" },
];

export function FeedExplorer({ initialItems }: { initialItems: ContentItem[] }) {
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [sort, setSort] = useState<"recommended" | "latest" | "value">(
    "recommended",
  );
  const [minValue, setMinValue] = useState(50);
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    return initialItems
      .filter((item) => platform === "all" || item.platform === platform)
      .filter((item) => item.hotScore >= minValue)
      .filter(
        (item) =>
          !query ||
          `${item.title} ${item.body} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort((a, b) => {
        if (sort === "value") return b.hotScore - a.hotScore;
        if (sort === "recommended") {
          return recommendationScore(b) - recommendationScore(a);
        }
        return (
          new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime()
        );
      });
  }, [initialItems, minValue, platform, query, sort]);

  return (
    <>
      <section className="filter-panel">
        <div className="segmented-control" aria-label="平台筛选">
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={platform === filter.value ? "active" : ""}
              onClick={() => setPlatform(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <span className="sr-only">搜索信息流</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Codex、VPS、U 币、开卡…"
          />
        </label>
        <select
          className="select-field"
          value={sort}
          onChange={(event) =>
            setSort(
              event.target.value as "recommended" | "latest" | "value",
            )
          }
          aria-label="排序方式"
        >
          <option value="recommended">推荐优先</option>
          <option value="latest">最新优先</option>
          <option value="value">价值最高</option>
        </select>
        <select
          className="select-field"
          value={minValue}
          onChange={(event) => setMinValue(Number(event.target.value))}
          aria-label="最低价值分"
        >
          <option value="50">价值达标（≥50）</option>
          <option value="70">高价值（≥70）</option>
          <option value="0">全部信号</option>
        </select>
      </section>
      <div className="result-line">
        <span>找到 {items.length} 条信息</span>
        <span>保留多语言 · 推荐依据可见 · AI 摘要已启用</span>
      </div>
      {items.length ? (
        <section className="content-grid feed-grid">
          {items.map((item) => (
            <ContentCard item={item} key={item.id} />
          ))}
        </section>
      ) : (
        <div className="empty-state">
          <strong>没有匹配内容</strong>
          <p>试试更宽泛的关键词或切换平台。</p>
        </div>
      )}
    </>
  );
}

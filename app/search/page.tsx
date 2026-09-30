import type { Metadata } from "next";
import Link from "next/link";
import { TopicSearch } from "./TopicSearch";

export const metadata: Metadata = { title: "话题搜索" };

export default function SearchPage() {
  return (
    <main className="page-stack topic-search-page">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">TOPIC SEARCH</span>
          <h1>话题搜索</h1>
          <p>从一个问题出发，自己选平台，寻找值得继续研究的内容。</p>
        </div>
        <Link className="button button-secondary" href="/review#review-inbox">查看审核中心 →</Link>
      </header>
      <TopicSearch />
    </main>
  );
}

import type { ReviewInboxLink } from "@/lib/types";

const platformLabels = {
  x: "X",
  youtube: "YouTube",
  linuxdo: "Linux.do",
  idcflare: "IDCFlare",
  gitlab: "GitLab",
  github: "GitHub",
};

function formatAddedAt(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ReviewInboxPanel({ links }: { links: ReviewInboxLink[] }) {
  return (
    <section
      className="review-inbox-panel"
      id="review-inbox"
      aria-labelledby="review-inbox-title"
    >
      <header className="review-inbox-heading">
        <div>
          <span>REVIEW INBOX</span>
          <h2 id="review-inbox-title">审核收件箱</h2>
          <p>这里显示所有在信息流中点击“存入审核中心”的信息链接。</p>
        </div>
        <strong>{links.length} 条</strong>
      </header>
      {links.length ? (
        <div className="review-inbox-list">
          {links.map((link) => (
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              key={link.contentId}
            >
              <span>
                {platformLabels[link.platform]} · {formatAddedAt(link.addedAt)} 存入
              </span>
              <strong>{link.title}</strong>
              <code>{link.url}</code>
              <small>{link.authorName || "作者待核对"}</small>
              <b>打开原文</b>
            </a>
          ))}
        </div>
      ) : (
        <div className="review-inbox-empty">
          <strong>还没有手动存入的链接</strong>
          <p>前往信息流，点击信息卡上的“存入审核中心”。</p>
        </div>
      )}
    </section>
  );
}

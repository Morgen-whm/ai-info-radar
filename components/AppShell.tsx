"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "实时总览", mark: "⌁" },
  { href: "/feed", label: "信息流", mark: "≋" },
  { href: "/topics", label: "热点话题", mark: "↗" },
  { href: "/weekly", label: "AI 周报", mark: "▦" },
  { href: "/sources", label: "监测源", mark: "◎" },
  { href: "/jobs", label: "采集任务", mark: "◫" },
  { href: "/settings", label: "系统设置", mark: "⚙" },
];

export function AppShell({
  children,
  mode,
}: {
  children: ReactNode;
  mode: "demo" | "live";
}) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>TrendHub</strong>
            <small>AI Intelligence</small>
          </div>
        </Link>

        <nav className="side-nav" aria-label="主要导航">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "nav-link active" : "nav-link"}
              >
                <span>{item.mark}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <div className="status-line">
            <span className="live-dot" />
            <strong>{mode === "live" ? "定时采集模式" : "本地手动模式"}</strong>
          </div>
          <p>
            {mode === "live"
              ? "后台定时任务与手动采集均已启用。"
              : "个人 Key 可真实采集；后台定时任务尚未启用。"}
          </p>
          <Link href="/settings">查看配置 →</Link>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">T</span>
            <strong>TrendHub</strong>
          </div>
          <nav className="mobile-nav" aria-label="移动端导航">
            {navItems.slice(0, 5).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  item.href === "/"
                    ? pathname === "/"
                      ? "active"
                      : ""
                    : pathname.startsWith(item.href)
                      ? "active"
                      : ""
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="timezone">America/Los_Angeles</span>
            <span className="demo-pill">
              {mode === "live" ? "LIVE" : "LOCAL"}
            </span>
            <span className="team-avatar">AI</span>
          </div>
        </header>
        <div className="page-wrap">{children}</div>
      </div>
    </div>
  );
}

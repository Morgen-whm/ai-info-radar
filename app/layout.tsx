import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { getAppEnv } from "@/db/runtime";
import "./globals.css";

const themeInitializer = `
  (() => {
    try {
      const stored = window.localStorage.getItem("trendhub-theme");
      const theme = stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  })();
`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const description =
    "面向团队内部的 X、YouTube、Linux.do、IDCFlare 与 GitLab AI 资讯自动采集、摘要与热点发现平台。";

  return {
    metadataBase,
    title: {
      default: "TrendHub AI 情报雷达",
      template: "%s · TrendHub",
    },
    description,
    openGraph: {
      title: "TrendHub · 实时 AI 情报雷达",
      description,
      type: "website",
      images: [{ url: "/og.png" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "TrendHub · 实时 AI 情报雷达",
      description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const env = await getAppEnv();
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>
        <AppShell mode={env.DATA_MODE === "live" ? "live" : "demo"}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { getAppEnv } from "@/db/runtime";
import "./globals.css";

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
    <html lang="zh-CN">
      <body>
        <AppShell mode={env.DATA_MODE === "live" ? "live" : "demo"}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

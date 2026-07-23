import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";

  return {
    metadataBase: new URL(origin),
    title: "流光对话 — Streaming AI Chat",
    description: "由 Next.js App Router 与 Vercel AI SDK 驱动的流式 AI 对话。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "流光对话",
      description: "把想法说出来，让答案流动起来。",
      type: "website",
      images: [{ url: "/og.png", width: 1740, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "流光对话",
      description: "把想法说出来，让答案流动起来。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

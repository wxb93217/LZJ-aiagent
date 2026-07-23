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
    title: "一二的小笨助手 — Streaming AI Chat",
    description: "一个小笨AI想要回答一二完成各种问题",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "一二的小笨助手",
      description: "一个小笨AI想要回答一二完成各种问题",
      type: "website",
      images: [{ url: "/og-v3.png", width: 1740, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "一二的小笨助手",
      description: "一个小笨AI想要回答一二完成各种问题",
      images: ["/og-v3.png"],
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

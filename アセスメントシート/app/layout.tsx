import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "アセスメントシート",
  description: "利用者支援のアセスメントを整理するための記録シートです。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <script src="https://app-development-gray.vercel.app/portal-auth-guard.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}

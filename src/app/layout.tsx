import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import "@fontsource-variable/outfit";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "BuildMaxxing | London Workcafes",
  description:
    "AI concierge for finding work-friendly cafes and third spaces in London.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="flex min-h-full flex-col">
        <AppNav />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>Powered by OpenRouter agents. Ready for Cloudflare Pages.</p>
            <p>Static seed data keeps the demo working without keys.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

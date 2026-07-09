import type { Metadata } from "next";
import type { ReactNode } from "react";
// 全局样式已迁至 `src/globals.css`(spec vite-spa-migration 任务 2.4)。
// 新旧宿主并存期,旧宿主从新位置引入;旧宿主删除后(任务 11)本文件一并移除。
import "../src/globals.css";
import { Providers } from "./providers";
import { WEBEXT_IMPORT_MAP } from "@/lib/app/webext-singletons";
import { WebextSingletonBridge } from "@/lib/app/webext-singleton-bridge";

export const metadata: Metadata = {
  title: "pi-web",
  description: "pi-web app shell — streaming agent chat",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* 单例 import map:须在任何代码 webext 动态 import 前就位(SSR 注入 <head>)。 */}
        <script
          type="importmap"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBEXT_IMPORT_MAP) }}
        />
      </head>
      <body>
        <WebextSingletonBridge />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

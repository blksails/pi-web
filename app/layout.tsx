import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { I18nProvider } from "@blksails/pi-web-ui";
import { ThemeControls } from "./theme-controls";
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
        <I18nProvider>
          <ThemeControls>
            <div className="flex h-dvh w-full flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
              {children}
            </div>
          </ThemeControls>
        </I18nProvider>
      </body>
    </html>
  );
}

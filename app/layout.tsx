import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeControls } from "./theme-controls";

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
      <body>
        <ThemeControls>
          <div className="flex h-dvh w-full flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
            {children}
          </div>
        </ThemeControls>
      </body>
    </html>
  );
}

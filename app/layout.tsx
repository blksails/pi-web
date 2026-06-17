import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
        <div className="flex h-screen w-screen flex-col bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
          {children}
        </div>
      </body>
    </html>
  );
}

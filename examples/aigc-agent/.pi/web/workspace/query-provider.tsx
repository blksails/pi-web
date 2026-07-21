// [迁移壳层] 源:aigc-agent components/query-provider.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * QueryProvider — 全局 React Query 客户端(③ app 壳 · 数据层)。
 *
 * 管**所有 Supabase 出站请求**(经 `/api/*` 路由)的缓存/去重/失效:素材目录树、当前目录素材、
 * pilabs 会话等以 `useQuery` 消费,同 key 命中缓存 → **不再每次打开重新加载**(承接用户要求:
 * 「一个管 ui(zustand),一个管 supabase 请求(react-query)」)。
 *
 * 低耦合:仅缓存 HTTP 结果,不直连 Supabase(隔离仍在 `/api/*` + supabase-admin);未来平台层换底不动此层。
 */
export function QueryProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1min 内视为新鲜,不重复请求
            gcTime: 5 * 60_000, // 缓存保留 5min
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/**
 * SPA 路由装配(spec vite-spa-migration 任务 4.2/4.3/4.4)。
 *
 * 三条路由,与迁移前的 Next 页面一一对应:
 *   `/`             ← app/page.tsx
 *   `/session/:id`  ← app/session/[id]/page.tsx
 *   `/settings`     ← app/settings/page.tsx
 *
 * `<BootstrapGate>` 下沉到各路由内部而非提在根:会话详情路由需要把 `:id` 传给配置端点
 * (`?sessionId=`)以恢复 agent source,根层拿不到路由参数。
 */
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Providers } from "./providers.js";
import { HomeRoute } from "./routes/home.js";
import { SessionRoute } from "./routes/session.js";
import { SettingsRoute } from "./routes/settings.js";

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Providers>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/session/:id" element={<SessionRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          {/* 服务端已做 SPA 回退;此处兜底把未知路径导回根。 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Providers>
    </BrowserRouter>
  );
}

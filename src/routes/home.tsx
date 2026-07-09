/**
 * `/` — 新会话(spec vite-spa-migration 任务 4.3,Req 3.1)。
 *
 * 迁移自 `app/page.tsx`(server component)。配置不再经 props 由服务端下传,而是经
 * `/api/bootstrap` 在运行时取得 —— provider 密钥同样永不到达浏览器。
 */
import { ChatApp } from "@/components/chat-app.js";
import { BootstrapGate, useBootstrap } from "../bootstrap.js";

function HomeInner(): React.JSX.Element {
  const config = useBootstrap();
  return (
    <ChatApp
      defaultSource={config.defaultSource}
      defaultModel={config.defaultModel}
      defaultCwd={config.defaultCwd}
      autoStart={config.autoStart}
    />
  );
}

export function HomeRoute(): React.JSX.Element {
  return (
    <BootstrapGate>
      <HomeInner />
    </BootstrapGate>
  );
}

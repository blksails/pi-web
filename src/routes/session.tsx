/**
 * `/session/:id` — 恢复已存在会话(spec vite-spa-migration 任务 4.3,Req 3.2/3.3)。
 *
 * 迁移自 `app/session/[id]/page.tsx`(server component)。那里在服务端做了一件**有实际功能
 * 意义**的事:按 id 恢复会话的 agent source(先查 app 级 sessionId → source 映射,再回退持久化
 * 的会话元数据)。缺了它,「刷新后 webext 扩展表面静默消失」—— `create.source` 会回退为 "."。
 *
 * SPA 下该恢复由 `GET /api/bootstrap?sessionId=` 在服务端完成,前端只消费结果。
 */
import { useParams } from "react-router";
import { ChatApp } from "@/components/chat-app.js";
import { BootstrapGate, useBootstrap } from "../bootstrap.js";

function SessionInner({ id }: { readonly id: string }): React.JSX.Element {
  const config = useBootstrap();
  return (
    <ChatApp
      defaultSource={config.defaultSource}
      defaultModel={config.defaultModel}
      defaultCwd={config.defaultCwd}
      resumeId={id}
      {...(config.resumeSource !== undefined
        ? { resumeSource: config.resumeSource }
        : {})}
    />
  );
}

export function SessionRoute(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (id === undefined || id.length === 0) {
    return <div className="p-6 text-sm text-red-600">缺少会话标识</div>;
  }
  return (
    <BootstrapGate sessionId={id}>
      <SessionInner id={id} />
    </BootstrapGate>
  );
}

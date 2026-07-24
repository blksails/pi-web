/**
 * 画布 pane 的 Guest 应用(隔离 iframe 内运行,Wave 5 · 6.1 隔离形态第三例)。
 *
 * 循 pi-web examples/panes-agent web/panes/canvas.tsx 范式(F3 门已验):复用
 * @blksails/pi-web-canvas-ui 的 CanvasPanel,guest SDK 四能力适配为其 props——
 * surface(surface:canvas 订阅/命令)/upload(attachment.put)/conversation(直送)。
 * 不复刻 aigc 壳的 CanvasWorkspace 外框(header/技能栏),画廊+二创工作台核心业务齐。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { CanvasPanel, canvasOpenStore } from "@blksails/pi-web-canvas-ui";
import type { ConversationAccess, WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";

function CanvasPane(): React.JSX.Element {
  const guest = usePaneGuest();
  React.useEffect(() => {
    canvasOpenStore.set(true);
    return () => canvasOpenStore.set(false);
  }, []);
  const surface = React.useMemo<WebExtSurfaceAccess>(
    () => ({
      run: async (domain, action, args) =>
        (await guest.surface.run(domain, action, args)) as Awaited<
          ReturnType<WebExtSurfaceAccess["run"]>
        >,
      getState: (key) => guest.surface.getState(key),
      subscribe: (key, listener) => guest.surface.subscribe(key, listener),
      hasCommand: (name) => guest.surface.hasCommand(name),
    }),
    [guest],
  );
  const upload = React.useCallback(
    async (_baseUrl: string, _sessionId: string, file: File) => {
      const result = await guest.upload(file);
      return { attachment: { id: result.attachmentId }, displayUrl: result.displayUrl };
    },
    [guest],
  );
  const conversation = React.useMemo<ConversationAccess>(
    () => ({
      submitUserMessage(text, options) {
        void guest.submitUserMessage(text, options);
      },
    }),
    [guest],
  );
  return (
    <CanvasPanel
      enabled
      surface={surface}
      upload={upload}
      baseUrl="pane://host"
      sessionId={guest.instanceId}
      conversation={conversation}
      visionModelOptions={[]}
    />
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="canvas" fallback={<main className="center muted">正在连接会话…</main>}>
      <CanvasPane />
    </PaneGuestProvider>,
  );
}

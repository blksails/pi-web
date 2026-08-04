import * as React from "react";
import { createRoot } from "react-dom/client";
import type { ConversationAccess, WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";
import { CanvasPanel } from "./canvas-launcher.js";
import {
  CANVAS_OPEN_ATTACHMENTS_EVENT,
  parseCanvasOpenAttachmentsEvent,
} from "./pane-contract.js";
import { canvasFocusStore, canvasOpenStore } from "./use-canvas-view.js";

/** 基座 Canvas 在隔离 Pane 内的标准 Guest；不含任何 Agent 私有代码。 */
export function CanvasPaneGuest(): React.JSX.Element {
  const guest = usePaneGuest();
  React.useEffect(() => {
    canvasOpenStore.set(true);
    return () => canvasOpenStore.set(false);
  }, []);
  React.useEffect(
    () =>
      guest.events.subscribe(CANVAS_OPEN_ATTACHMENTS_EVENT, (payload) => {
        const event = parseCanvasOpenAttachmentsEvent(payload);
        if (event === undefined) return;
        void Promise.all(
          event.attachmentIds.map((attachmentId) =>
            guest.surface.run("canvas", "register", { attachmentId }),
          ),
        )
          .then(() => canvasFocusStore.set(event.attachmentIds[0] ?? null))
          .catch(() => undefined);
      }),
    [guest],
  );
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
      return {
        attachment: { id: result.attachmentId },
        displayUrl: result.displayUrl,
      };
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
    <PaneGuestProvider
      paneId="canvas"
      fallback={<main className="center muted">正在连接会话…</main>}
    >
      <CanvasPaneGuest />
    </PaneGuestProvider>,
  );
}

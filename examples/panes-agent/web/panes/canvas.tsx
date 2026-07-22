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
  const surface = React.useMemo<WebExtSurfaceAccess>(() => ({
    run: async (domain, action, args) => await guest.surface.run(domain, action, args) as Awaited<ReturnType<WebExtSurfaceAccess["run"]>>,
    getState: (key) => guest.surface.getState(key),
    subscribe: (key, listener) => guest.surface.subscribe(key, listener),
    hasCommand: (name) => guest.surface.hasCommand(name),
  }), [guest]);
  const upload = React.useCallback(async (_baseUrl: string, _sessionId: string, file: File) => {
    const result = await guest.upload(file);
    return { attachment: { id: result.attachmentId }, displayUrl: result.displayUrl };
  }, [guest]);
  const conversation = React.useMemo<ConversationAccess>(() => ({
    submitUserMessage(text, options) {
      void guest.submitUserMessage(text, options);
    },
  }), [guest]);
  return <CanvasPanel
    enabled
    surface={surface}
    upload={upload}
    baseUrl="pane://host"
    sessionId={guest.instanceId}
    conversation={conversation}
    visionModelOptions={[]}
  />;
}

const root = document.getElementById("root");
if (root === null) throw new Error("Pane root missing");
createRoot(root).render(<React.StrictMode><PaneGuestProvider paneId="canvas"><CanvasPane /></PaneGuestProvider></React.StrictMode>);

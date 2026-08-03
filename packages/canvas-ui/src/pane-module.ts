import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit";
import { CANVAS_OPEN_ATTACHMENTS_EVENT } from "./pane-contract.js";

export interface CanvasPaneModule {
  readonly id: "canvas";
  readonly title: string;
  readonly icon: string;
  readonly entry: URL;
  readonly canvasStyles: true;
  readonly capabilities: NonNullable<PaneDefinitionInput["capabilities"]>;
}

/** 基座内置 Canvas 的可直嵌 Pane 声明；Agent 只需并入 panes 清单。 */
export const canvasPaneModule: CanvasPaneModule = {
  id: "canvas",
  title: "画布",
  icon: "palette",
  entry: new URL("./pane-guest.tsx", import.meta.url),
  canvasStyles: true,
  capabilities: {
    surfaceKeys: ["surface:canvas"],
    surfaceCommands: [
      {
        domain: "canvas",
        actions: [
          "sync",
          "register",
          "edit",
          "inpaint",
          "reference",
          "variants",
          "outpaint",
          "reframe",
          "delete",
        ],
      },
    ],
    events: { subscribe: [CANVAS_OPEN_ATTACHMENTS_EVENT] },
    attachments: "read-write",
    conversation: "submit",
  },
};

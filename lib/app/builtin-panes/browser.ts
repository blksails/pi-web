import { HOST_PANE_ID_PREFIX } from "@blksails/pi-web-panes-kit";
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";
import { builtinPaneDocuments } from "../../../panes/generated.js";

const DOCUMENT_KEY = "browser";
export const BROWSER_PANE_ID = `${HOST_PANE_ID_PREFIX}${DOCUMENT_KEY}`;

export function browserPane(): PaneDefinitionInput | undefined {
  const srcDoc = builtinPaneDocuments[DOCUMENT_KEY];
  if (typeof srcDoc !== "string" || srcDoc.length === 0) return undefined;
  return {
    id: BROWSER_PANE_ID,
    title: "浏览器",
    // inline：PanesHost 入口 withDefaultPaneChrome 强制装 tabs；勿用裸 public URL。
    document: { kind: "inline", srcDoc },
    // The browser guest has no host route, state, event, attachment, or conversation grant.
    capabilities: {},
    allowMultiple: false,
    maxInstances: 1,
    lifecycle: { keepAlive: true, suspendWhenHidden: false },
  };
}

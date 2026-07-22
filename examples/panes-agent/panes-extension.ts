import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSurface } from "@blksails/pi-web-tool-kit/runtime";
import {
  getPanesSnapshot,
  setPanesPublisher,
  type PanesSnapshot,
} from "./panes-state.js";

/** Surface 只发布小而热的修订摘要；面板正文由 Agent Route 按需读取。 */
export function panesSurfaceExtension(pi: ExtensionAPI): void {
  const handle = createSurface<PanesSnapshot>(pi, {
    domain: "panes",
    initialState: getPanesSnapshot(),
    commands: {
      refresh: () => getPanesSnapshot(),
    },
  });
  setPanesPublisher((next) => handle.update(() => next));
}

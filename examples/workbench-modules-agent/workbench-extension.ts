import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSurface } from "@blksails/pi-web-tool-kit/runtime";
import {
  getWorkbenchSnapshot,
  setWorkbenchPublisher,
  type WorkbenchSnapshot,
} from "./workbench-state.js";

/** Surface 只发布小而热的修订摘要；模块正文由 Agent Route 按需读取。 */
export function workbenchSurfaceExtension(pi: ExtensionAPI): void {
  const handle = createSurface<WorkbenchSnapshot>(pi, {
    domain: "workbench",
    initialState: getWorkbenchSnapshot(),
    commands: {
      refresh: () => getWorkbenchSnapshot(),
    },
  });
  setWorkbenchPublisher((next) => handle.update(() => next));
}

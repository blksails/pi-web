/**
 * confirm-demo — a `.pi/` resource sample that drives the permission-dialog
 * (extension UI) closed loop.
 *
 * When activated, the extension asks the host for a `confirm` decision before
 * proceeding. The pi-web server forwards this as an `extension_ui_request`
 * frame; the browser renders <PiPermissionDialog>, the user answers, and the
 * response is posted back to the session so the agent continues (Req 7 / 8.3).
 *
 * This sample documents the authoring shape for real mode. The deterministic
 * e2e drives the same closed loop through the stub agent (lib/app/
 * stub-agent-process.mjs), which emits the identical `extension_ui_request`
 * frame without any API cost.
 */
import type { ExtensionFactory } from "@pi-web/agent-kit";

const confirmDemo: ExtensionFactory = (ctx) => ({
  name: "confirm-demo",
  async activate() {
    const confirmed = await ctx.ui.confirm({
      title: "Proceed?",
      message: "Allow the demo extension to continue?",
    });
    return { confirmed };
  },
});

export default confirmDemo;

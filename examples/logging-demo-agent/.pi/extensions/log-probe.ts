/**
 * log-probe — pi extension that directly imports @pi-web/logger.
 *
 * Verifies design option-b: pi extensions do NOT depend on the pi SDK logging
 * API; instead they import the project's own logger library directly (Req 2.3).
 *
 * Namespace: ext:log-probe
 *
 * Requirements: 2.3, 2.4
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@pi-web/logger";

const logger = createLogger({ namespace: "ext:log-probe", level: "debug" });

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    logger.info("session_start received");
    logger.debug("debug detail on session start", {
      extensionName: "log-probe",
    });
    ctx.ui.notify("ext:log-probe loaded — check the logs panel", "info");
  });

  pi.registerCommand("log-probe", {
    description: "Emit sample log entries from the log-probe extension",
    handler: async (_args, ctx) => {
      logger.info("command triggered by user");
      logger.warn("sample warning from command");
      logger.error("sample error from command (not a real error)");
      ctx.ui.notify("log-probe: emitted info/warn/error — check logs panel", "info");
    },
  });
}

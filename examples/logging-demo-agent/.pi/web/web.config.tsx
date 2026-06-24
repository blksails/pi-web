/**
 * logging-demo-agent UI extension — browser-side log emission.
 *
 * Demonstrates the webext → browser log bus path:
 * - imports createLogger from @pi-web/logger (browser build, no Node imports)
 * - emits a log entry on render, which goes to the browser-side ring buffer
 *   and from there to the logs panel via the logsStore subscription (Req 1.5, 3.4).
 *
 * Namespace: webext:logging-demo
 *
 * Requirements: 1.5, 3.4, 5.2
 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";
import { createLogger } from "@pi-web/logger";

const webextLogger = createLogger({
  namespace: "webext:logging-demo",
  level: "debug",
});

function LoggingDemoHeader(): React.JSX.Element {
  React.useEffect(() => {
    webextLogger.info("mounted — browser log bus active");
    webextLogger.debug("debug detail", { source: "web.config.tsx" });
  }, []);

  return (
    <span data-testid="logging-demo-header" style={{ fontSize: 12, opacity: 0.7 }}>
      Logging Demo
    </span>
  );
}

export default defineWebExtension({
  manifestId: "logging-demo",
  capabilities: ["slots", "config"],
  config: {
    documentTitle: "Logging Demo Agent",
  },
  slots: {
    headerCenter: <LoggingDemoHeader />,
  },
});

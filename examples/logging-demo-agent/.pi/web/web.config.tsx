/**
 * logging-demo-agent UI extension — browser-side log emission.
 *
 * Demonstrates the webext → browser log bus path:
 * - imports createLogger from @blksails/pi-web-logger (browser build, no Node imports)
 * - emits a log entry on render, which goes to the browser-side ring buffer
 *   and from there to the logs panel via the logsStore subscription (Req 1.5, 3.4).
 *
 * Namespace: webext:logging-demo
 *
 * Requirements: 1.5, 3.4, 5.2
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import { createLogger } from "@blksails/pi-web-logger";

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

function LoggingDemoLogsSlot(): React.JSX.Element {
  return (
    <div
      data-testid="logging-demo-logs-slot"
      style={{
        fontSize: 11,
        opacity: 0.8,
        padding: "4px 8px",
        borderTop: "1px solid currentColor",
        marginTop: 4,
      }}
    >
      📋 logging-demo webext logs slot
    </div>
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
    logs: <LoggingDemoLogsSlot />,
  },
});

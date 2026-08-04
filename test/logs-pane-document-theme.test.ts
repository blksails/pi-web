import { describe, expect, it } from "vitest";

import { LOGS_PANE_HTML } from "../packages/ui/src/logs/logs-pane-document.js";

describe("logs pane document theme", () => {
  it("consumes host theme tokens and live updates", () => {
    expect(LOGS_PANE_HTML).toContain("pane:theme");
    expect(LOGS_PANE_HTML).toContain("var(--background");
    expect(LOGS_PANE_HTML).not.toContain("color-scheme:dark");
  });
});

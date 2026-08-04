import { describe, expect, it } from "vitest";
import { resolveExtensionForSource } from "../lib/app/webext-registry.js";

describe("aigc-agent webext pane contract", () => {
  it("exports the PaneContributionBundle directly", () => {
    const extension = resolveExtensionForSource("C:\\workcode\\pi-web\\examples\\aigc-agent");
    expect(extension?.panes).not.toHaveProperty("definition");
    expect(extension?.panes?.panes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "search" }),
      expect.objectContaining({ id: "materials" }),
      expect.objectContaining({ id: "canvas" }),
      expect.objectContaining({ id: "logs" }),
    ]));
  });
});

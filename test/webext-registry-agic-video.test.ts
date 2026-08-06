import { describe, expect, it } from "vitest";
import { resolveExtensionForSource } from "../lib/app/webext-registry.js";

describe("agic-video-agent webext video studio contract", () => {
  it("loads the isolated video studio pane with surface grants", () => {
    const extension = resolveExtensionForSource("C:\\workcode\\pi-web\\examples\\agic-video-agent");
    expect(extension?.manifestId).toBe("agic-video-studio");
    expect(extension?.panes?.panes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "video-studio",
        capabilities: expect.objectContaining({
          surfaceKeys: ["surface:video-studio"],
          conversation: "submit",
        }),
      }),
    ]));
  });
});

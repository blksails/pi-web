/**
 * pi-clouds online path still resolves with PI_WEB_DESKTOP=1 and no local webapp.
 */
import { describe, expect, it } from "vitest";
import { resolveBakedCloudEgressBase, DESKTOP_MARKER_ENV } from "../lib/app/cloud-defaults.js";

describe("resolveBakedCloudEgressBase", () => {
  it("desktop marker → baked online pi-cloud egress", () => {
    const base = resolveBakedCloudEgressBase({ [DESKTOP_MARKER_ENV]: "1" });
    expect(base).toBeTruthy();
    expect(base).toMatch(/^https:\/\//);
    expect(base).toContain("pi-cloud");
  });

  it("non-desktop → undefined (no forced login wall)", () => {
    expect(resolveBakedCloudEgressBase({})).toBeUndefined();
  });
});

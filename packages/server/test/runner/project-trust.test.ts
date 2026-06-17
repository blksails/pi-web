import { describe, expect, it } from "vitest";
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { makeResolveProjectTrust } from "../../src/runner/project-trust.js";

// Minimal stand-in; the hook never inspects this value.
const fakeExtensionsResult = {} as LoadExtensionsResult;

describe("makeResolveProjectTrust (Req 5.2/5.3)", () => {
  it("returns true when trusted=true (load .pi/ project resources)", async () => {
    const resolve = makeResolveProjectTrust(true);
    await expect(resolve({ extensionsResult: fakeExtensionsResult })).resolves.toBe(true);
  });

  it("returns false when trusted=false (ignore .pi/ project resources)", async () => {
    const resolve = makeResolveProjectTrust(false);
    await expect(resolve({ extensionsResult: fakeExtensionsResult })).resolves.toBe(false);
  });
});

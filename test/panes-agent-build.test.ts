// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { computeIntegrity } from "../packages/web-kit/build/manifest-emit.js";
import { findBundledSingletons } from "../packages/web-kit/build/externals-guard.js";
import { buildPanesAgent } from "../examples/panes-agent/build.js";

describe("panes-agent web build", () => {
  it("bundles five isolated React panes and keeps .pi runtime-only", async () => {
    const result = await buildPanesAgent();
    expect(result.manifest).toMatchObject({ id: "panes", targetApiVersion: "^0.5.0" });
    const code = await readFile(result.entryOut, "utf8");
    expect(findBundledSingletons(code)).toHaveLength(0);
    expect(result.manifest.integrity).toBe(computeIntegrity(Buffer.from(code, "utf8")));
    expect(code).toContain("create-artifact");
    expect(code).toMatch(/sandbox:\s*"allow-scripts"/);
    expect(code).toContain("pane:connected");
    expect(code).toContain("surface:canvas");
    expect(code).toContain("canvas-checkerboard");
    expect(code).toContain("HOST_UNAVAILABLE");

    const piWebEntries = await readdir(new URL("../examples/panes-agent/.pi/web/", import.meta.url));
    expect(piWebEntries).toEqual(["dist"]);
  }, 20_000);
});

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wecomExtensionEntryPath } from "../src/entry-path.js";

describe("wecomExtensionEntryPath", () => {
  it("resolves to an existing index.ts", () => {
    const p = wecomExtensionEntryPath();
    expect(p).toBeTruthy();
    expect(existsSync(p!)).toBe(true);
    expect(p!.endsWith("index.ts")).toBe(true);
  });
});

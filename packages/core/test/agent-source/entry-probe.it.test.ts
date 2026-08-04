import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeEntry } from "../../src/agent-source/entry-probe.js";
import { EntryOverrideError } from "../../src/agent-source/errors.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "asr-probe-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, content = "//") {
  await fs.writeFile(path.join(dir, name), content, "utf8");
}

describe("probeEntry — entry precedence & pi-web.entry override", () => {
  it("returns none when no entry and no package.json", async () => {
    expect(await probeEntry(dir)).toEqual({ kind: "none" });
  });

  it("picks index.js when only index.js present", async () => {
    await write("index.js");
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "index.js") });
  });

  it("prefers index.ts when all three present", async () => {
    await write("index.ts");
    await write("index.js");
    await write("index.mjs");
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "index.ts") });
  });

  it("prefers index.js over index.mjs", async () => {
    await write("index.js");
    await write("index.mjs");
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "index.js") });
  });

  it("pi-web.entry override takes precedence over default probe", async () => {
    await write("index.ts");
    await write("custom.ts");
    await write("package.json", JSON.stringify({ "pi-web": { entry: "custom.ts" } }));
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "custom.ts") });
  });

  it("pi-web.entry override pointing to a MISSING file throws (no silent fallback)", async () => {
    await write("index.ts"); // valid default exists, must NOT be used
    await write("package.json", JSON.stringify({ "pi-web": { entry: "does-not-exist.ts" } }));
    await expect(probeEntry(dir)).rejects.toBeInstanceOf(EntryOverrideError);
    try {
      await probeEntry(dir);
    } catch (e) {
      expect((e as EntryOverrideError).overridePath).toBe(path.join(dir, "does-not-exist.ts"));
    }
  });

  it("ignores malformed package.json and falls back to default probe", async () => {
    await write("index.js");
    await write("package.json", "{ not json");
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "index.js") });
  });

  it("ignores package.json without pi-web.entry", async () => {
    await write("index.mjs");
    await write("package.json", JSON.stringify({ name: "x" }));
    const r = await probeEntry(dir);
    expect(r).toEqual({ kind: "entry", path: path.join(dir, "index.mjs") });
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAgentEntry } from "../../src/runner/agent-compiler.js";

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prepareAgentEntry", () => {
  it("编译一次后复用缓存，源码变更才生成新产物", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-compiler-"));
    tempRoots.push(root);
    const entry = path.join(root, "index.ts");
    const cacheDir = path.join(root, "cache");
    await writeFile(entry, "export default { systemPrompt: 'one' }\n", "utf8");

    const first = await prepareAgentEntry(entry, root, { cacheDir });
    const second = await prepareAgentEntry(entry, root, { cacheDir });
    expect(first.compiled).toBe(true);
    expect(first.cacheHit).toBe(false);
    expect(second).toMatchObject({ compiled: true, cacheHit: true, path: first.path });
    expect(await readFile(first.path, "utf8")).toContain("systemPrompt");

    await writeFile(entry, "export default { systemPrompt: 'two' }\n", "utf8");
    const changed = await prepareAgentEntry(entry, root, { cacheDir });
    expect(changed.compiled).toBe(true);
    expect(changed.cacheHit).toBe(false);
    expect(changed.path).not.toBe(first.path);
  });
});

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

  it("★ 同目录不同 entry 不得共享缓存（key 必须含 entry 身份）", async () => {
    // 真实事故形态:test/runner/fixtures/ 下多个单文件 fixture agent 共处一目录,
    // runner 以 dirname(entry) 为源码根 → 目录内容哈希对所有 entry 相同。
    // 若 key 不含 entry 本身,先编译者的 bundle 会被后续所有 agent 复用——
    // attachment-profile-invalid-agent 因此载入了别人的 bundle,装配期白名单校验被旁路。
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-compiler-"));
    tempRoots.push(root);
    const cacheDir = path.join(root, "cache");
    const entryA = path.join(root, "agent-a.ts");
    const entryB = path.join(root, "agent-b.ts");
    await writeFile(entryA, "export default { systemPrompt: 'alpha' }\n", "utf8");
    await writeFile(entryB, "export default { systemPrompt: 'beta' }\n", "utf8");

    const a = await prepareAgentEntry(entryA, root, { cacheDir });
    const b = await prepareAgentEntry(entryB, root, { cacheDir });
    expect(a.compiled).toBe(true);
    expect(b.compiled).toBe(true);
    // 产物路径不同只是必要条件;致命处在内容——B 拿到 A 的 bundle 就是白名单旁路的根源。
    expect(b.path).not.toBe(a.path);
    expect(await readFile(a.path, "utf8")).toContain("alpha");
    expect(await readFile(b.path, "utf8")).toContain("beta");
  });
});

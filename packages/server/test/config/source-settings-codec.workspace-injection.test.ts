/**
 * SourceSettingsCodec Workspace 注入接缝(spec: config-workspace-injection,Req 2)。
 *
 * 验注入的双根 `Workspace`:source→`workspace.user`、project→`workspace.project`(注入时无需 cwd),
 * 键与路径分支逐一致;`assertSourceKeyShape` 两分支都强制。
 */
import { describe, it, expect } from "vitest";
import { SourceSettingsCodec } from "../../src/config/source-settings-codec.js";
import { createMemoryWorkspace } from "../workspace/fixtures/memory-workspace.js";

const KEY = "0123456789abcdef"; // 合法 16-hex sourceKey

describe("SourceSettingsCodec Workspace 注入(Req 2)", () => {
  it("source→user 根、project→project 根(注入时 project scope 不需 cwd)", async () => {
    const { workspace } = createMemoryWorkspace();
    const codec = new SourceSettingsCodec(workspace);

    await codec.save("source", KEY, { s: 1 });
    await codec.save("project", KEY, { p: 1 }); // 注入分支:无需 cwd

    expect(await codec.load("source", KEY)).toEqual({ s: 1 });
    expect(await codec.load("project", KEY)).toEqual({ p: 1 });

    // 双根落对应命名空间 + 键正确(契约 §3.3)。
    expect(await workspace.user.readJson(`sources/${KEY}/settings.json`)).toEqual({ s: 1 });
    expect(await workspace.project.readJson(`source-settings/${KEY}.json`)).toEqual({ p: 1 });
    // 互不串根。
    expect(await workspace.project.readJson(`sources/${KEY}/settings.json`)).toEqual({});
  });

  it("deepMerge 与 merge:false 覆盖(注入分支)", async () => {
    const { workspace } = createMemoryWorkspace();
    const codec = new SourceSettingsCodec(workspace);
    await codec.save("source", KEY, { a: { x: 1 }, keep: "y" });
    await codec.save("source", KEY, { a: { z: 2 } });
    expect(await codec.load("source", KEY)).toEqual({ a: { x: 1, z: 2 }, keep: "y" });
    await codec.save("source", KEY, { a: 9 }, { merge: false });
    expect(await codec.load("source", KEY)).toEqual({ a: 9 });
  });

  it("非法 sourceKey 被拒(assertSourceKeyShape,注入分支同样强制)", async () => {
    const { workspace } = createMemoryWorkspace();
    const codec = new SourceSettingsCodec(workspace);
    await expect(codec.load("source", "../evil")).rejects.toThrow();
    await expect(codec.save("source", "not-hex", { a: 1 })).rejects.toThrow();
  });
});

/**
 * ConfigCodec Workspace 注入接缝(spec: config-workspace-injection,Req 1)。
 *
 * 验注入的 `WorkspaceNamespace`(内存 Workspace 的 user 根)承载 config.domains 读写,且与
 * 路径分支语义等价:缺键→{}、deepMerge、merge:false 覆盖删除、损坏→降级 {}。
 */
import { describe, it, expect } from "vitest";
import { ConfigCodec } from "../../src/config/config-codec.js";
import { createMemoryWorkspace } from "../workspace/fixtures/memory-workspace.js";

describe("ConfigCodec Workspace 注入(Req 1)", () => {
  it("注入 namespace:缺键→{}、deepMerge、merge:false 覆盖", async () => {
    const { workspace } = createMemoryWorkspace();
    const codec = new ConfigCodec(workspace.user);

    expect(await codec.load("settings")).toEqual({}); // 缺键
    await codec.save("settings", { a: { x: 1 }, keep: "y" });
    await codec.save("settings", { a: { z: 2 } }); // 缺省 deepMerge
    expect(await codec.load("settings")).toEqual({ a: { x: 1, z: 2 }, keep: "y" });
    await codec.save("settings", { a: 9 }, { merge: false }); // 覆盖(删除未提供键)
    expect(await codec.load("settings")).toEqual({ a: 9 });
  });

  it("读写确实导向注入的命名空间(键 <domain>.json)", async () => {
    const { workspace } = createMemoryWorkspace();
    const codec = new ConfigCodec(workspace.user);
    await codec.save("auth", { token: "t" });
    // 直接经注入 ns 读回,证明写入的是注入命名空间而非本地 fs。
    expect(await workspace.user.readJson("auth.json")).toEqual({ token: "t" });
  });

  it("既有值损坏 → load 降级 {}(不抛,契约 §3.6)", async () => {
    const handle = createMemoryWorkspace();
    const codec = new ConfigCodec(handle.workspace.user);
    await codec.save("logging", { level: "debug" });
    await handle.corrupt("user", "logging.json");
    expect(await codec.load("logging")).toEqual({});
  });

  it("未注入(路径/undefined)仍走现状分支,不受影响", async () => {
    // 不传 → 自建 LocalWorkspace(default root);仅验构造不抛、load 缺键为 {}。
    const codec = new ConfigCodec();
    expect(await codec.load("sandbox")).toBeTypeOf("object");
  });
});

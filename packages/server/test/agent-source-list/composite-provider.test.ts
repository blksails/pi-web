/**
 * 单元:CompositeSourceProvider —— 去重合并 + 稳定排序 + 容错。
 *
 * 覆盖 Req 4.1(同 id 去重为一)、4.2(registry 覆盖 scan 元数据)、
 * 4.3(稳定排序:registry 优先→name)、子 provider 失败被吞不致整体失败。
 */
import { describe, it, expect } from "vitest";
import { createCompositeSourceProvider } from "../../src/agent-source-list/index.js";
import type {
  AgentSourceProvider,
  AgentSourceRecord,
} from "../../src/agent-source-list/index.js";

function fixed(records: AgentSourceRecord[]): AgentSourceProvider {
  return { list: () => Promise.resolve(records) };
}
function failing(): AgentSourceProvider {
  return {
    list: () => Promise.reject(new Error("boom")),
  };
}

const scanRec = (id: string, name: string): AgentSourceRecord => ({
  id,
  source: id,
  name,
  kind: "dir",
  origin: "scan",
  mode: "cli",
});
const regRec = (id: string, name: string): AgentSourceRecord => ({
  id,
  source: id,
  name,
  kind: "dir",
  origin: "registry",
  mode: "custom",
});

describe("CompositeSourceProvider", () => {
  it("同 id 在两路命中 → 去重为一,采用 registry 元数据(Req 4.1/4.2)", async () => {
    const registry = fixed([regRec("/a", "Registry Name")]);
    const scan = fixed([scanRec("/a", "Scan Name")]);
    const recs = await createCompositeSourceProvider(registry, scan).list();
    expect(recs).toHaveLength(1);
    expect(recs[0]!.name).toBe("Registry Name");
    expect(recs[0]!.origin).toBe("registry");
    expect(recs[0]!.mode).toBe("custom");
  });

  it("稳定排序:registry 优先,其后按 name(Req 4.3)", async () => {
    const registry = fixed([regRec("/r2", "Zeta"), regRec("/r1", "Alpha")]);
    const scan = fixed([scanRec("/s2", "beta"), scanRec("/s1", "aaa")]);
    const recs = await createCompositeSourceProvider(registry, scan).list();
    // registry 段(按 name): Alpha, Zeta;scan 段(按 name): aaa, beta。
    expect(recs.map((r) => r.name)).toEqual(["Alpha", "Zeta", "aaa", "beta"]);
    // 同一输入多次调用结果一致(稳定)。
    const again = await createCompositeSourceProvider(registry, scan).list();
    expect(again.map((r) => r.id)).toEqual(recs.map((r) => r.id));
  });

  it("registry provider 失败 → 退化为空贡献,scan 结果仍返回", async () => {
    const scan = fixed([scanRec("/s", "S")]);
    const recs = await createCompositeSourceProvider(failing(), scan).list();
    expect(recs.map((r) => r.id)).toEqual(["/s"]);
  });

  it("两路均失败 → 空列表,不抛", async () => {
    await expect(
      createCompositeSourceProvider(failing(), failing()).list(),
    ).resolves.toEqual([]);
  });

  it("N 路:先见者胜(云 registry 覆盖本地登记与扫描)", async () => {
    const cloud = fixed([
      {
        id: "acme/bot",
        source: "acme/bot@stable",
        name: "Cloud Bot",
        kind: "dir",
        origin: "registry",
        mode: "cli",
      },
    ]);
    const fileReg = fixed([
      {
        id: "acme/bot",
        source: "/local/acme-bot",
        name: "Local File",
        kind: "dir",
        origin: "registry",
        mode: "custom",
      },
      regRec("/only-file", "FileOnly"),
    ]);
    const scan = fixed([
      scanRec("acme/bot", "Scan Bot"),
      scanRec("/only-scan", "ScanOnly"),
    ]);
    const recs = await createCompositeSourceProvider(cloud, fileReg, scan).list();
    const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
    expect(byId["acme/bot"]!.name).toBe("Cloud Bot");
    expect(byId["acme/bot"]!.source).toBe("acme/bot@stable");
    expect(byId["/only-file"]!.name).toBe("FileOnly");
    expect(byId["/only-scan"]!.name).toBe("ScanOnly");
    expect(recs).toHaveLength(3);
  });

  it("零路 providers → 空列表", async () => {
    await expect(createCompositeSourceProvider().list()).resolves.toEqual([]);
  });
});

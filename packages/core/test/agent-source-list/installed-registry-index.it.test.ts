/**
 * installed-registry-index(desktop-online-source-runnable 任务 1.2)——
 * 已安装线上源的本机索引:读回执 → 按 sourceId 查目录。
 *
 * ★ 降级优先:任何异常(无回执/JSON 损坏/缺必需字段/根不存在/不可读)一律视为
 *   「该目录不属于本通道」并返回 undefined,**绝不抛出** —— 否则一个坏目录会
 *   拖垮整个源列表(P1 Req 1.3 的 fail-soft 精神)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readInstalledReceipt,
  createInstalledRegistryIndex,
} from "../../src/agent-source-list/installed-registry-index.js";

let root: string;
const created: string[] = [];

function makeDir(name: string, receipt?: unknown | string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (receipt !== undefined) {
    const body = typeof receipt === "string" ? receipt : JSON.stringify(receipt);
    writeFileSync(join(dir, ".pi-web-registry.json"), body);
  }
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-installed-idx-"));
  created.push(root);
});

afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readInstalledReceipt", () => {
  it("读出 sourceId 与 channel", () => {
    const dir = makeDir("acme__canvas", {
      sourceId: "acme/canvas",
      channel: "stable",
      version: "1.2.0",
    });
    expect(readInstalledReceipt(dir)).toEqual({
      sourceId: "acme/canvas",
      channel: "stable",
      version: "1.2.0",
    });
  });

  it("容忍未知字段(上游新增字段不得破坏本通道)", () => {
    const dir = makeDir("x", {
      sourceId: "a/b",
      channel: "stable",
      pinnedVersion: "1.0.0",
      somethingNew: { nested: true },
    });
    const r = readInstalledReceipt(dir);
    expect(r?.sourceId).toBe("a/b");
    expect(r?.channel).toBe("stable");
  });

  describe("降级为 undefined 且不抛", () => {
    it("目录无回执", () => {
      expect(readInstalledReceipt(makeDir("plain"))).toBeUndefined();
    });

    it("回执 JSON 损坏", () => {
      expect(readInstalledReceipt(makeDir("broken", "{ not json"))).toBeUndefined();
    });

    it("缺 sourceId", () => {
      expect(readInstalledReceipt(makeDir("nosid", { channel: "stable" }))).toBeUndefined();
    });

    it("缺 channel", () => {
      expect(readInstalledReceipt(makeDir("nochan", { sourceId: "a/b" }))).toBeUndefined();
    });

    it("字段类型不对", () => {
      expect(
        readInstalledReceipt(makeDir("badtype", { sourceId: 42, channel: "stable" })),
      ).toBeUndefined();
    });

    it("目录不存在", () => {
      expect(readInstalledReceipt(join(root, "does-not-exist"))).toBeUndefined();
    });
  });
});

describe("createInstalledRegistryIndex", () => {
  it("按 sourceId 查到目录与回执", () => {
    const dir = makeDir("acme__canvas", { sourceId: "acme/canvas", channel: "stable" });
    const idx = createInstalledRegistryIndex({ roots: [root] });
    const hit = idx.lookup("acme/canvas");
    expect(hit?.dir).toBe(dir);
    expect(hit?.receipt.channel).toBe("stable");
  });

  it("未安装的 sourceId 不命中", () => {
    makeDir("acme__canvas", { sourceId: "acme/canvas", channel: "stable" });
    const idx = createInstalledRegistryIndex({ roots: [root] });
    expect(idx.lookup("other/thing")).toBeUndefined();
  });

  it("无回执的目录不进索引(不影响其余条目)", () => {
    makeDir("plain-local-agent");
    const dir = makeDir("acme__canvas", { sourceId: "acme/canvas", channel: "stable" });
    const idx = createInstalledRegistryIndex({ roots: [root] });
    expect(idx.lookup("acme/canvas")?.dir).toBe(dir);
  });

  it("坏回执目录不拖垮整个索引", () => {
    makeDir("broken", "{ not json");
    const dir = makeDir("good", { sourceId: "a/b", channel: "stable" });
    const idx = createInstalledRegistryIndex({ roots: [root] });
    expect(idx.lookup("a/b")?.dir).toBe(dir);
  });

  it("根不存在 → 空索引且不抛", () => {
    const idx = createInstalledRegistryIndex({ roots: [join(root, "nope")] });
    expect(idx.lookup("a/b")).toBeUndefined();
  });

  it("零个根 → 空索引", () => {
    const idx = createInstalledRegistryIndex({ roots: [] });
    expect(idx.lookup("a/b")).toBeUndefined();
  });

  it("多个根:先注册的根优先(与 composite 先见者胜一致)", () => {
    const root2 = mkdtempSync(join(tmpdir(), "pi-installed-idx2-"));
    created.push(root2);
    const first = makeDir("first", { sourceId: "dup/x", channel: "stable" });
    const second = join(root2, "second");
    mkdirSync(second, { recursive: true });
    writeFileSync(
      join(second, ".pi-web-registry.json"),
      JSON.stringify({ sourceId: "dup/x", channel: "beta" }),
    );
    const idx = createInstalledRegistryIndex({ roots: [root, root2] });
    expect(idx.lookup("dup/x")?.dir).toBe(first);
  });
});

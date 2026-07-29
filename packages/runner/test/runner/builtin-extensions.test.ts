/**
 * 单元:内置扩展单一清单 + 自解析(spec: runner-self-resolved-builtins,任务 1.2;
 * Req 1.1, 1.3, 1.4, 1.5, 5.2, 5.3)。
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_EXTENSIONS,
  resolveBuiltinExtensionEntries,
  type BuiltinExtensionSpec,
} from "../../src/runner/builtin-extensions.js";

const spec = (id: BuiltinExtensionSpec["id"], resolve: () => string | undefined): BuiltinExtensionSpec => ({
  id,
  resolve,
});

describe("BUILTIN_EXTENSIONS — 单一清单(Req 5.2)", () => {
  it("含三个 pi-web 自带扩展,顺序稳定(Req 1.5)", () => {
    expect(BUILTIN_EXTENSIONS.map((s) => s.id)).toEqual([
      "extension-tools",
      "auto-title",
      "mcp",
    ]);
  });

  it("★ 不含 sandbox —— 其入口在 agent 包内,范式不同(范围勘误)", () => {
    // 变异判据:若把 sandbox 并入清单,此断言转红。sandbox 须继续走 PI_WEB_SANDBOX_ENTRY。
    expect(BUILTIN_EXTENSIONS.map((s) => s.id)).not.toContain("sandbox");
  });

  it("真实清单在本仓语境下三项均可解析(Req 2.1)", () => {
    // 本地 monorepo 中三个 entry-path 都应指向真实存在的文件。
    const entries = resolveBuiltinExtensionEntries();
    expect(entries).toHaveLength(3);
    for (const p of entries) expect(p.length).toBeGreaterThan(0);
  });
});

describe("resolveBuiltinExtensionEntries — 解析与降级(Req 1.3, 1.4, 5.3)", () => {
  it("按清单顺序返回可解析入口", () => {
    const entries = resolveBuiltinExtensionEntries([
      spec("extension-tools", () => "/a/ext.ts"),
      spec("auto-title", () => "/a/title.ts"),
      spec("mcp", () => "/a/mcp.ts"),
    ]);
    expect(entries).toEqual(["/a/ext.ts", "/a/title.ts", "/a/mcp.ts"]);
  });

  it("解析不到的条目被跳过,其余照常返回(Req 1.4)", () => {
    const entries = resolveBuiltinExtensionEntries([
      spec("extension-tools", () => undefined),
      spec("auto-title", () => "/a/title.ts"),
      spec("mcp", () => ""),
    ]);
    // 变异判据:若不过滤 undefined/空串,长度会变 3 → 转红。
    expect(entries).toEqual(["/a/title.ts"]);
  });

  it("单个条目抛错被吞掉,不影响其余、不外溢(Req 1.4)", () => {
    const entries = resolveBuiltinExtensionEntries([
      spec("extension-tools", () => {
        throw new Error("boom");
      }),
      spec("mcp", () => "/a/mcp.ts"),
    ]);
    expect(entries).toEqual(["/a/mcp.ts"]);
  });

  it("全部不可解析 → 空数组,不抛出(降级为无内置扩展)", () => {
    expect(() =>
      resolveBuiltinExtensionEntries([spec("mcp", () => undefined)]),
    ).not.toThrow();
    expect(resolveBuiltinExtensionEntries([spec("mcp", () => undefined)])).toEqual([]);
  });
});

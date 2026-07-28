/**
 * 单元:自解析结果并入注入路径 + 既有 env 过渡兼容去重
 * (spec: runner-self-resolved-builtins,任务 2.1;Req 1.1, 1.2, 3.1, 3.3)。
 */
import { describe, it, expect } from "vitest";
import {
  collectExtensionPaths,
  collectForcedExtensionPaths,
  mapResourceLoaderOptions,
} from "../../src/runner/option-mapper.js";

const EXT = "/pkg/tool-kit/src/extension-tools/extension-manager.ts";
const AUTO = "/pkg/tool-kit/src/auto-title/auto-title-extension.ts";
const MCP = "/pkg/tool-kit/src/mcp/mcp-extension.ts";
const SBX = "/agent/pi-sandbox/index.ts";

describe("collectExtensionPaths — 自解析为主来源(Req 1.1, 1.2)", () => {
  it("env 为空时,注入路径完全来自自解析", () => {
    // 变异判据:若 buildRuntimeFactory 仍只读 env,自解析结果不会出现 → 转红。
    expect(collectExtensionPaths({}, [EXT, AUTO, MCP])).toEqual([EXT, AUTO, MCP]);
  });

  it("sandbox 仍以 env 为准(不在自解析范围),且排在自解析项之前", () => {
    expect(collectExtensionPaths({ PI_WEB_SANDBOX_ENTRY: SBX }, [EXT, MCP])).toEqual([
      SBX,
      EXT,
      MCP,
    ]);
  });
});

describe("过渡期兼容:既有 *_ENTRY env(Req 3.3)", () => {
  it("env 与自解析指向同一路径时**去重**,不重复注入", () => {
    const out = collectExtensionPaths(
      { PI_WEB_MCP_ENTRY: MCP, PI_WEB_AUTO_TITLE_ENTRY: AUTO },
      [EXT, AUTO, MCP],
    );
    // 变异判据:若不去重,MCP/AUTO 会各出现两次 → 转红。
    expect(out).toEqual([AUTO, MCP, EXT]);
    expect(new Set(out).size).toBe(out.length);
  });

  it("外部编排仍设置这些 env 时不报错(容忍残留)", () => {
    expect(() =>
      collectExtensionPaths({ PI_WEB_EXT_TOOLS_ENTRY: EXT, PI_WEB_MCP_ENTRY: MCP }, []),
    ).not.toThrow();
  });

  it("collectForcedExtensionPaths 仍按固定顺序识别四个 env(未被删除)", () => {
    expect(
      collectForcedExtensionPaths({
        PI_WEB_SANDBOX_ENTRY: SBX,
        PI_WEB_EXT_TOOLS_ENTRY: EXT,
        PI_WEB_AUTO_TITLE_ENTRY: AUTO,
        PI_WEB_MCP_ENTRY: MCP,
      }),
    ).toEqual([SBX, EXT, AUTO, MCP]);
  });
});

describe("注入面:自解析路径进入 additionalExtensionPaths(Req 3.1)", () => {
  it("即便关闭系统扩展发现,内置扩展仍被强制注入", () => {
    const forced = collectExtensionPaths({}, [EXT, AUTO, MCP]);
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { allowExtensions: [] },
      { forcedExtensionPaths: forced },
    );
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([EXT, AUTO, MCP]);
    expect(resourceLoaderOptions.noExtensions).toBe(true);
  });
});

/**
 * 内置 MCP 客户端扩展的强制注入(spec: builtin-mcp-client,任务 4.1;Req 5.1):
 * `PI_WEB_MCP_ENTRY` 经 spawn env 下传时并入 forcedExtensionPaths,且与既有强制注入入口共存。
 *
 * 这是「零扩展依赖」的关键接缝 —— 若该 env 未被 runner 消费,MCP 能力会**静默不可用**
 * (无报错、无日志,只是工具不出现),故此守卫必须存在。
 */
import { describe, expect, it } from "vitest";
import {
  collectForcedExtensionPaths,
  mapResourceLoaderOptions,
} from "../../src/runner/option-mapper.js";

const MCP = "/home/u/pi-web/packages/tool-kit/src/mcp/mcp-extension.ts";
const AUTO = "/home/u/.pi/.../auto-title/auto-title-extension.ts";
const SBX = "/home/u/.pi/.../pi-sandbox/index.ts";
const EXT = "/home/u/.pi/.../extension-tools/extension-manager.ts";

describe("collectForcedExtensionPaths (mcp)", () => {
  it("设置 PI_WEB_MCP_ENTRY → 含该路径(Req 5.1)", () => {
    // 变异判据:若 collectForcedExtensionPaths 漏读该键,MCP 扩展永不注入 → 转红。
    expect(collectForcedExtensionPaths({ PI_WEB_MCP_ENTRY: MCP })).toEqual([MCP]);
  });

  it("未设置 / 空串 → 不注入(解析不到入口时跳过,不阻塞会话)", () => {
    expect(collectForcedExtensionPaths({})).toEqual([]);
    expect(collectForcedExtensionPaths({ PI_WEB_MCP_ENTRY: "" })).toEqual([]);
  });

  it("与既有三个入口共存,顺序固定 sandbox → ext-tools → auto-title → mcp", () => {
    expect(
      collectForcedExtensionPaths({
        PI_WEB_SANDBOX_ENTRY: SBX,
        PI_WEB_EXT_TOOLS_ENTRY: EXT,
        PI_WEB_AUTO_TITLE_ENTRY: AUTO,
        PI_WEB_MCP_ENTRY: MCP,
      }),
    ).toEqual([SBX, EXT, AUTO, MCP]);
  });

  it("MCP 入口经 mapResourceLoaderOptions 进入 additionalExtensionPaths(豁免系统资源开关)", () => {
    const forced = collectForcedExtensionPaths({ PI_WEB_MCP_ENTRY: MCP });
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { allowExtensions: [] },
      { forcedExtensionPaths: forced },
    );
    // 即便用户关掉了系统扩展发现,内置 MCP 仍须可用(它是一等公民,不是被发现的扩展)。
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([MCP]);
    expect(resourceLoaderOptions.noExtensions).toBe(true);
  });
});

/**
 * 自动会话标题扩展强制注入(spec auto-session-title, Req 5.5):
 * PI_WEB_AUTO_TITLE_ENTRY 经 env 下传时并入 forcedExtensionPaths,且与既有强制注入入口共存。
 */
import { describe, expect, it } from "vitest";
import {
  collectForcedExtensionPaths,
  mapResourceLoaderOptions,
} from "../../src/runner/option-mapper.js";

const AUTO = "/home/u/.pi/.../auto-title/auto-title-extension.ts";
const SBX = "/home/u/.pi/.../pi-sandbox/index.ts";
const EXT = "/home/u/.pi/.../extension-tools/extension-manager.ts";

describe("collectForcedExtensionPaths (auto-title)", () => {
  it("设置 PI_WEB_AUTO_TITLE_ENTRY → 含该路径", () => {
    expect(collectForcedExtensionPaths({ PI_WEB_AUTO_TITLE_ENTRY: AUTO })).toEqual([AUTO]);
  });

  it("未设置 → 不含自动标题路径", () => {
    expect(collectForcedExtensionPaths({})).toEqual([]);
    expect(collectForcedExtensionPaths({ PI_WEB_AUTO_TITLE_ENTRY: "" })).toEqual([]);
  });

  it("与 sandbox / ext-tools 共存,顺序固定 sandbox → ext-tools → auto-title", () => {
    expect(
      collectForcedExtensionPaths({
        PI_WEB_SANDBOX_ENTRY: SBX,
        PI_WEB_EXT_TOOLS_ENTRY: EXT,
        PI_WEB_AUTO_TITLE_ENTRY: AUTO,
      }),
    ).toEqual([SBX, EXT, AUTO]);
  });

  it("自动标题入口经 mapResourceLoaderOptions 进入 additionalExtensionPaths(豁免白名单)", () => {
    const forced = collectForcedExtensionPaths({ PI_WEB_AUTO_TITLE_ENTRY: AUTO });
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { allowExtensions: [] },
      { forcedExtensionPaths: forced },
    );
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([AUTO]);
    // noExtensions 下强制注入路径仍加载(SDK 仍解析强制入口)。
    expect(resourceLoaderOptions.noExtensions).toBe(true);
  });
});

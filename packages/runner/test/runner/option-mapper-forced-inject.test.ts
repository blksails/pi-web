/**
 * 强制注入(req 1):forcedExtensionPaths 始终随会话加载,且豁免 allowExtensions 白名单。
 */
import { describe, expect, it } from "vitest";
import { mapResourceLoaderOptions } from "../../src/runner/option-mapper.js";

const SBX = "/home/u/.pi/agent/npm/node_modules/pi-sandbox/index.ts";

describe("mapResourceLoaderOptions forcedExtensionPaths (强制注入)", () => {
  it("把强制路径追加到 additionalExtensionPaths(置前)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { extensions: ["./a.js"] },
      { forcedExtensionPaths: [SBX] },
    );
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([SBX, "./a.js"]);
  });

  it("无 def.extensions 时也注入强制路径", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      {},
      { forcedExtensionPaths: [SBX] },
    );
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([SBX]);
  });

  it("allowExtensions=[](noExtensions)下强制路径仍在 additionalExtensionPaths(SDK 仍加载)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { allowExtensions: [] },
      { forcedExtensionPaths: [SBX] },
    );
    expect(resourceLoaderOptions.noExtensions).toBe(true);
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual([SBX]);
  });

  it("白名单(allowExtensions=['keep'])豁免强制注入的 basename", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { allowExtensions: ["keep"] },
      { forcedExtensionPaths: [SBX] },
    );
    const override = resourceLoaderOptions.extensionsOverride;
    expect(typeof override).toBe("function");
    const base = {
      extensions: [
        { path: SBX },
        { path: "/somewhere/keep.ts" },
        { path: "/somewhere/other.ts" },
      ],
      errors: [],
      runtime: {},
    } as unknown as Parameters<NonNullable<typeof override>>[0];
    const kept = override!(base).extensions.map((e) => e.path);
    expect(kept).toContain(SBX); // 强制注入豁免
    expect(kept).toContain("/somewhere/keep.ts"); // 白名单命中
    expect(kept).not.toContain("/somewhere/other.ts"); // 既非白名单也非强制 → 过滤
  });

  it("无 forcedExtensionPaths 时行为不变(仅 factories → 不设 additionalExtensionPaths)", () => {
    const factory = (() => {}) as unknown as NonNullable<
      Parameters<typeof mapResourceLoaderOptions>[0]["extensions"]
    >[number];
    const { resourceLoaderOptions } = mapResourceLoaderOptions({ extensions: [factory] });
    expect("additionalExtensionPaths" in resourceLoaderOptions).toBe(false);
  });
});

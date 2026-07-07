/**
 * app 侧桌面桥访问器单测(spec desktop-directory-picker task 1.2,Req 1.2/1.3/4.2)。
 *
 * getPiWebDesktopBridge 读取 window.piWebDesktop:浏览器态(无注入)→ undefined;桌面态 →
 * 透出含 pickDirectory 的桥。jsdom 提供 window。
 */
import { afterEach, describe, it, expect } from "vitest";
import { getPiWebDesktopBridge } from "@/lib/app/desktop-bridge";

afterEach(() => {
  delete (window as Window & { piWebDesktop?: unknown }).piWebDesktop;
});

describe("getPiWebDesktopBridge(桌面桥访问器)", () => {
  it("无注入(浏览器态)→ undefined(Req 1.3/4.2)", () => {
    expect(getPiWebDesktopBridge()).toBeUndefined();
  });

  it("桌面态注入 → 透出桥且含 pickDirectory(Req 1.2)", async () => {
    const pickDirectory = (): Promise<string | undefined> => Promise.resolve("/picked");
    (window as Window & { piWebDesktop?: unknown }).piWebDesktop = {
      readonly: true,
      platform: "darwin",
      pickDirectory,
    };
    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.platform).toBe("darwin");
    expect(bridge?.pickDirectory).toBe(pickDirectory);
    await expect(bridge?.pickDirectory?.()).resolves.toBe("/picked");
  });

  it("旧版壳(无 pickDirectory)→ 桥存在但方法为 undefined(向后兼容)", () => {
    (window as Window & { piWebDesktop?: unknown }).piWebDesktop = {
      readonly: true,
      platform: "linux",
    };
    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.pickDirectory).toBeUndefined();
  });
});

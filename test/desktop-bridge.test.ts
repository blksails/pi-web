/**
 * app 侧桌面桥访问器单测(spec electron-to-tauri 任务 5.2,Req 6.1/6.7)。
 *
 * getPiWebDesktopBridge 三态探测:
 *   1. `window.piWebDesktop`(Electron 壳,向后兼容)
 *   2. `window.__TAURI__`(Tauri 壳,合成同形状桥)
 *   3. 无注入(浏览器/SSR 态)→ undefined ⇒ 「浏览文件夹」入口不渲染
 * jsdom 提供 window。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { getPiWebDesktopBridge } from "@/lib/app/desktop-bridge";

type TestWindow = Window & { piWebDesktop?: unknown; __TAURI__?: unknown };

afterEach(() => {
  delete (window as TestWindow).piWebDesktop;
  delete (window as TestWindow).__TAURI__;
  vi.restoreAllMocks();
});

describe("getPiWebDesktopBridge(桌面桥访问器)", () => {
  it("无注入(浏览器态)→ undefined(Req 6.7)", () => {
    expect(getPiWebDesktopBridge()).toBeUndefined();
  });

  // ── Electron 壳:向后兼容,行为不得改变 ──

  it("Electron 壳注入 → 原样透出该桥(Req 6.1)", async () => {
    const pickDirectory = (): Promise<string | undefined> => Promise.resolve("/picked");
    (window as TestWindow).piWebDesktop = { readonly: true, platform: "darwin", pickDirectory };
    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.platform).toBe("darwin");
    expect(bridge?.pickDirectory).toBe(pickDirectory);
    await expect(bridge?.pickDirectory?.()).resolves.toBe("/picked");
  });

  it("旧版 Electron 壳(无 pickDirectory)→ 桥存在但方法为 undefined(向后兼容)", () => {
    (window as TestWindow).piWebDesktop = { readonly: true, platform: "linux" };
    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.pickDirectory).toBeUndefined();
  });

  it("两者都存在时优先 Electron 桥(不改变既有壳的行为)", async () => {
    const pickDirectory = (): Promise<string | undefined> => Promise.resolve("/from-electron");
    (window as TestWindow).piWebDesktop = { readonly: true, platform: "darwin", pickDirectory };
    (window as TestWindow).__TAURI__ = { core: { invoke: async () => "/from-tauri" } };
    await expect(getPiWebDesktopBridge()?.pickDirectory?.()).resolves.toBe("/from-electron");
  });

  // ── Tauri 壳:合成桥 ──

  it("仅 __TAURI__ 存在 → 合成同形状桥,pickDirectory 经 invoke 回传路径(Req 6.1/6.3)", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      expect(cmd).toBe("pick_directory");
      return "/Users/x/agents/demo";
    });
    (window as TestWindow).__TAURI__ = { core: { invoke } };

    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.readonly).toBe(true);
    expect(typeof bridge?.pickDirectory).toBe("function");
    await expect(bridge?.pickDirectory?.()).resolves.toBe("/Users/x/agents/demo");
    expect(invoke).toHaveBeenCalledWith("pick_directory");
  });

  it("Tauri 桥:用户取消(命令返回 null)→ undefined(Req 6.4)", async () => {
    (window as TestWindow).__TAURI__ = { core: { invoke: async () => null } };
    await expect(getPiWebDesktopBridge()?.pickDirectory?.()).resolves.toBeUndefined();
  });

  it("Tauri 桥:命令返回空串 → undefined", async () => {
    (window as TestWindow).__TAURI__ = { core: { invoke: async () => "" } };
    await expect(getPiWebDesktopBridge()?.pickDirectory?.()).resolves.toBeUndefined();
  });

  it("Tauri 桥:invoke reject(如 ACL 拒绝)→ resolve 为 undefined,绝不向上抛(Req 6.5)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (window as TestWindow).__TAURI__ = {
      core: {
        invoke: async () => {
          throw new Error("pick_directory not allowed. Plugin not found");
        },
      },
    };
    // 不得 reject —— 前端调用点(AgentSourcePicker)据此保持来源框原值。
    await expect(getPiWebDesktopBridge()?.pickDirectory?.()).resolves.toBeUndefined();
  });

  it("Tauri 全局存在但 invoke 不可用 → 仍算桌面态,但无 pickDirectory", () => {
    (window as TestWindow).__TAURI__ = {};
    const bridge = getPiWebDesktopBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.readonly).toBe(true);
    expect(bridge?.pickDirectory).toBeUndefined();
  });

  it("Tauri 桥:platform 由 userAgent 归一化", () => {
    (window as TestWindow).__TAURI__ = { core: { invoke: async () => null } };
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    );
    expect(getPiWebDesktopBridge()?.platform).toBe("darwin");
  });
});

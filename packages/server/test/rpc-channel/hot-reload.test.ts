/**
 * hot-reload 开关门控:默认关闭;仅 dev + PI_RUNNER_HOT_RELOAD=1 启用。
 *
 * 注:启用后的 watch→restart 端到端路径依赖 fs.watch 时序(CI 易抖),不在单测覆盖;
 * 已手工端到端验证(改文件 → 子进程重启、通道续用)。这里只锁定确定性的门控行为。
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import {
  isHotReloadEnabled,
  registerForHotReload,
  watchPaths,
  type HotReloadTarget,
} from "../../src/rpc-channel/hot-reload.js";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

function makeTarget(): HotReloadTarget & { restarts: number } {
  return {
    restarts: 0,
    requestRestart() {
      this.restarts++;
    },
  };
}

describe("hot-reload 门控", () => {
  it("默认(无 env)关闭", () => {
    delete process.env["PI_RUNNER_HOT_RELOAD"];
    process.env["NODE_ENV"] = "development";
    expect(isHotReloadEnabled()).toBe(false);
  });

  it("production 即使开了开关也关闭", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PI_RUNNER_HOT_RELOAD"] = "1";
    expect(isHotReloadEnabled()).toBe(false);
  });

  it("dev + PI_RUNNER_HOT_RELOAD=1 启用", () => {
    process.env["NODE_ENV"] = "development";
    process.env["PI_RUNNER_HOT_RELOAD"] = "1";
    expect(isHotReloadEnabled()).toBe(true);
  });

  it("未启用时 registerForHotReload 返回空操作且不抛", () => {
    delete process.env["PI_RUNNER_HOT_RELOAD"];
    process.env["NODE_ENV"] = "development";
    const target = makeTarget();
    const unregister = registerForHotReload(target);
    expect(typeof unregister).toBe("function");
    expect(() => unregister()).not.toThrow();
    expect(target.restarts).toBe(0);
  });
});

describe("watchPaths 目录解析", () => {
  it("默认解析出**真实存在**的 tool-kit/src(不受 import.meta.url 落进 .next bundle 影响)", () => {
    delete process.env["PI_RUNNER_HOT_RELOAD_PATHS"];
    const dirs = watchPaths();
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.every((d) => d.endsWith(`tool-kit/src`))).toBe(true);
    // 每个返回项都真实存在(存在性过滤是本修复的核心:虚构路径会让 fs.watch 静默失效)。
    expect(dirs.every((d) => existsSync(d))).toBe(true);
  });

  it("PI_RUNNER_HOT_RELOAD_PATHS 覆盖 → 原样返回(不做存在性过滤)", () => {
    process.env["PI_RUNNER_HOT_RELOAD_PATHS"] = "/a/x, /b/y ";
    expect(watchPaths()).toEqual(["/a/x", "/b/y"]);
  });
});

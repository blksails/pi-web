/**
 * 父进程守望(spec: desktop-exit-orphan)。
 *
 * ★ 本文件最要紧的是**不该自尽的那几种情形**,而不是"壳没了会自尽":
 *   - 没有 `PI_WEB_SHELL_PID`(`pnpm dev:server` / npm CLI / 容器)→ 根本不启动。
 *     那些形态下「父进程没了」是正常的(nohup / systemd / docker),自尽是错的。
 *   - env 值非法 → 不启动。解析出 NaN 就把自己杀掉是最荒唐的失败形态。
 *   - 探测抛 EPERM(进程在、但不属于本用户)→ 视为活着,不自尽。
 */
import { describe, it, expect, vi } from "vitest";
import {
  startParentWatchdog,
  SHELL_PID_ENV,
  WATCHDOG_INTERVAL_MS,
} from "../src/parent-watchdog.js";

const ALIVE_PID = 4242;

describe("★ 不启用的情形(误启用的后果是 server 无故自尽)", () => {
  it.each([
    ["无 env(pnpm dev:server / npm CLI / 容器)", {}],
    ["空串", { [SHELL_PID_ENV]: "" }],
    ["纯空白", { [SHELL_PID_ENV]: "   " }],
    ["非数字", { [SHELL_PID_ENV]: "abc" }],
    ["小数", { [SHELL_PID_ENV]: "12.5" }],
    ["0", { [SHELL_PID_ENV]: "0" }],
    ["1(init 自身,不可能是壳)", { [SHELL_PID_ENV]: "1" }],
    ["负数", { [SHELL_PID_ENV]: "-3" }],
  ])("%s → 不启动,返回 undefined", (_n, env) => {
    let gone = 0;
    const stop = startParentWatchdog({
      env,
      isAlive: () => false, // 即便探测说"没了",也不该有任何动作
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 1,
    });
    expect(stop).toBeUndefined();
    expect(gone).toBe(0);
  });
});

describe("启用后的行为", () => {
  it("父进程健在 → 不触发", async () => {
    vi.useFakeTimers();
    let gone = 0;
    const stop = startParentWatchdog({
      env: { [SHELL_PID_ENV]: String(ALIVE_PID) },
      isAlive: () => true,
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 10,
    });
    expect(stop).toBeDefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(gone).toBe(0);
    stop?.();
    vi.useRealTimers();
  });

  it("父进程消失 → 触发一次收尾(且只触发一次,不重复)", async () => {
    vi.useFakeTimers();
    let gone = 0;
    let alive = true;
    startParentWatchdog({
      env: { [SHELL_PID_ENV]: String(ALIVE_PID) },
      isAlive: () => alive,
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 10,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(gone).toBe(0);
    alive = false;
    await vi.advanceTimersByTimeAsync(50);
    // 触发后须停表 —— 否则会反复调用 shutdown,而那条路径里有 process.exit。
    expect(gone).toBe(1);
    vi.useRealTimers();
  });

  it("stop() 后不再探测", async () => {
    vi.useFakeTimers();
    let gone = 0;
    const stop = startParentWatchdog({
      env: { [SHELL_PID_ENV]: String(ALIVE_PID) },
      isAlive: () => false,
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 10,
    });
    stop?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(gone).toBe(0);
    vi.useRealTimers();
  });

  it("默认间隔 2s —— 壳退出后端口最多多占这么久", () => {
    expect(WATCHDOG_INTERVAL_MS).toBe(2_000);
  });
});

describe("默认存在性探测(真实 process.kill 语义)", () => {
  it("本进程自身 → 活着", async () => {
    vi.useFakeTimers();
    let gone = 0;
    const stop = startParentWatchdog({
      env: { [SHELL_PID_ENV]: String(process.pid) },
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 5,
    });
    await vi.advanceTimersByTimeAsync(30);
    expect(gone).toBe(0);
    stop?.();
    vi.useRealTimers();
  });

  it("几乎不可能存在的 pid → 判定已消失", async () => {
    vi.useFakeTimers();
    let gone = 0;
    // 远超常见 pid_max;若真撞上一个存活进程,这条会假绿而非假红,可接受。
    startParentWatchdog({
      env: { [SHELL_PID_ENV]: "4194303" },
      onParentGone: () => {
        gone += 1;
      },
      intervalMs: 5,
    });
    await vi.advanceTimersByTimeAsync(30);
    expect(gone).toBe(1);
    vi.useRealTimers();
  });
});

/**
 * 桌面壳:启动失败文案纯函数单测(spec pi-web-desktop task 2.5,Req 2.1/2.2/2.3)。
 * describeStartupError 把判别式启动错误映射为可读标题+详情;showStartupError 的
 * dialog/退出重试接线需 electron 运行时,由 e2e 覆盖。
 */
import { describe, it, expect } from "vitest";
import { describeStartupError } from "@/desktop/src/startup-error";
import type { ServerStartError } from "@/desktop/src/server-supervisor";

describe("describeStartupError(可读失败提示 — Req 2.1/2.2/2.3)", () => {
  it("no-free-port → 提示端口被占用,含起始端口(Req 2.3)", () => {
    const err: ServerStartError = { kind: "no-free-port", triedFrom: 3000 };
    const d = describeStartupError(err);
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.detail).toMatch(/端口/);
    expect(d.detail).toMatch(/3000/);
  });

  it("early-exit → 提示服务器退出,含退出码与 stderr 线索(Req 2.2)", () => {
    const err: ServerStartError = {
      kind: "early-exit",
      code: 1,
      stderrTail: "Error: cannot find module 'foo'",
    };
    const d = describeStartupError(err);
    expect(d.detail).toMatch(/退出|失败/);
    expect(d.detail).toMatch(/cannot find module/); // stderr 线索透出
    expect(d.detail).toMatch(/1/); // 退出码
  });

  it("early-exit 无 stderr 也给可读提示(不崩)", () => {
    const err: ServerStartError = { kind: "early-exit", code: null, stderrTail: "" };
    const d = describeStartupError(err);
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.detail.length).toBeGreaterThan(0);
  });

  it("ready-timeout → 提示超时,含超时时长(Req 2.1)", () => {
    const err: ServerStartError = { kind: "ready-timeout", timeoutMs: 60_000 };
    const d = describeStartupError(err);
    expect(d.detail).toMatch(/超时/);
    expect(d.detail).toMatch(/60/); // 60s / 60000ms
  });
});

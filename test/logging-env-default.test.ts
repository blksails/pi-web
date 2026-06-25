/**
 * resolveLoggingEnvDefault — 服务端日志门控「无配置文件」默认值（从 env 推导）。
 *
 * 核心契约：日志默认**关闭**；`PI_WEB_LOG_ENABLED` 可强制开启（无需 Settings）。
 */
import { describe, it, expect } from "vitest";
import { resolveLoggingEnvDefault } from "../lib/app/logging-default.js";

describe("resolveLoggingEnvDefault — enabled 默认关闭", () => {
  it("env 全空 → enabled=false（默认关闭）", () => {
    expect(resolveLoggingEnvDefault({}).enabled).toBe(false);
  });

  it("PI_WEB_LOG_ENABLED=1 → 强制开启", () => {
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_ENABLED: "1" }).enabled).toBe(true);
  });

  it("PI_WEB_LOG_ENABLED=true → 开启", () => {
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_ENABLED: "true" }).enabled).toBe(true);
  });

  it("PI_WEB_LOG_ENABLED=false → 关闭（大小写不敏感）", () => {
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_ENABLED: "FALSE" }).enabled).toBe(false);
  });
});

describe("resolveLoggingEnvDefault — level", () => {
  it("未设 → 默认 info", () => {
    expect(resolveLoggingEnvDefault({}).level).toBe("info");
  });

  it("合法级别被采用（大小写不敏感）", () => {
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_LEVEL: "warn" }).level).toBe("warn");
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_LEVEL: "DEBUG" }).level).toBe("debug");
  });

  it("非法级别回落 info", () => {
    expect(resolveLoggingEnvDefault({ PI_WEB_LOG_LEVEL: "verbose" }).level).toBe("info");
  });
});

describe("resolveLoggingEnvDefault — namespaces", () => {
  it("未设 → 省略 namespaces 字段", () => {
    expect(resolveLoggingEnvDefault({}).namespaces).toBeUndefined();
  });

  it("逗号分隔 → 各置 true，去空白/空项", () => {
    const ns = resolveLoggingEnvDefault({
      PI_WEB_LOG_NAMESPACES: " agent:hello , ext:probe , ",
    }).namespaces;
    expect(ns).toEqual({ "agent:hello": true, "ext:probe": true });
  });
});

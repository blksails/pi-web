/**
 * resolveLoggingEnvDefault — 服务端日志门控「无配置文件」默认值（从 env 推导）。
 *
 * 核心契约：`PI_WEB_LOG_ENABLED` 显式优先；未设置时 **dev 默认开、生产默认关**。
 *
 * ⚠ 「默认关闭」这条旧契约已按需求变更：dev 下开发者要看的就是日志，让他每次先去
 *   Settings 翻开关是纯粹的摩擦。生产仍默认关闭（序列化 + IO 成本，且可能含业务内容）。
 */
import { describe, it, expect } from "vitest";
import {
  isDevMode,
  resolveEnabledWithSource,
  resolveLoggingEnvDefault,
} from "../lib/app/logging-default.js";

const PROD = { NODE_ENV: "production" } as const;
const DEV = { NODE_ENV: "development" } as const;

describe("resolveLoggingEnvDefault — enabled 的模式默认", () => {
  it("生产 + env 未设 → enabled=false", () => {
    expect(resolveLoggingEnvDefault(PROD).enabled).toBe(false);
  });

  it("dev + env 未设 → enabled=true", () => {
    expect(resolveLoggingEnvDefault(DEV).enabled).toBe(true);
  });

  it("NODE_ENV 缺席按 dev 处理（与 hot-reload 的判据一致）", () => {
    expect(isDevMode({})).toBe(true);
    expect(resolveLoggingEnvDefault({}).enabled).toBe(true);
  });

  it("生产下 PI_WEB_LOG_ENABLED=1 仍可开启", () => {
    expect(resolveLoggingEnvDefault({ ...PROD, PI_WEB_LOG_ENABLED: "1" }).enabled).toBe(
      true,
    );
  });

  it("dev 下 PI_WEB_LOG_ENABLED=false 可显式关闭（模式默认不是霸王条款）", () => {
    expect(
      resolveLoggingEnvDefault({ ...DEV, PI_WEB_LOG_ENABLED: "false" }).enabled,
    ).toBe(false);
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

describe("resolveEnabledWithSource — 优先级 env > Settings > 模式默认", () => {
  it("★env 压过已保存的 Settings（改造前 env 在有配置文件时完全失效）", () => {
    const r = resolveEnabledWithSource({ enabled: false }, { ...DEV, PI_WEB_LOG_ENABLED: "1" });
    expect(r).toEqual({ enabled: true, source: "env" });
  });

  it("★env=false 也压过 Settings 的 true（覆盖是双向的）", () => {
    const r = resolveEnabledWithSource({ enabled: true }, { ...DEV, PI_WEB_LOG_ENABLED: "false" });
    expect(r).toEqual({ enabled: false, source: "env" });
  });

  it("Settings 显式 false → 尊重用户选择，dev 默认不覆盖", () => {
    expect(resolveEnabledWithSource({ enabled: false }, DEV)).toEqual({
      enabled: false,
      source: "settings",
    });
  });

  it("Settings 显式 true → 生产下也开", () => {
    expect(resolveEnabledWithSource({ enabled: true }, PROD)).toEqual({
      enabled: true,
      source: "settings",
    });
  });

  it("★配置存在但没有 enabled 字段 → 不算用户选择，回落模式默认", () => {
    // 判据取**原始** JSON:若在 schema.parse 之后判断,缺省会被补成 false,
    // 「用户主动关」与「压根没设过」就永远分不开,dev 默认开也就永不生效。
    expect(resolveEnabledWithSource({ level: "debug" }, DEV)).toEqual({
      enabled: true,
      source: "dev-default",
    });
    expect(resolveEnabledWithSource({ level: "debug" }, PROD)).toEqual({
      enabled: false,
      source: "prod-default",
    });
  });

  it("无配置(null/undefined) → 模式默认", () => {
    expect(resolveEnabledWithSource(null, DEV).source).toBe("dev-default");
    expect(resolveEnabledWithSource(undefined, PROD).source).toBe("prod-default");
  });

  it("enabled 是非布尔值 → 视为未设置（不被 truthy 字符串误开）", () => {
    expect(resolveEnabledWithSource({ enabled: "false" }, PROD)).toEqual({
      enabled: false,
      source: "prod-default",
    });
  });
});

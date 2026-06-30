/**
 * resolveBashEnabled — bang shell 命令能力的「无配置」启用默认值(从 env 推导)。
 *
 * 核心契约:**默认关闭**(secure by default);`PI_WEB_BASH_ENABLED` 显式开启。
 * 对应 requirements 5.1 / 5.6。
 */
import { describe, it, expect } from "vitest";
import { resolveBashEnabled } from "../lib/app/bash-default.js";

describe("resolveBashEnabled — 默认关闭(secure by default)", () => {
  it("env 全空 → false(默认关闭)", () => {
    expect(resolveBashEnabled({})).toBe(false);
  });

  it("PI_WEB_BASH_ENABLED 未设置 → false", () => {
    expect(resolveBashEnabled({ OTHER: "1" })).toBe(false);
  });

  it("PI_WEB_BASH_ENABLED=1 → 开启", () => {
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "1" })).toBe(true);
  });

  it("PI_WEB_BASH_ENABLED=true → 开启(大小写不敏感)", () => {
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "true" })).toBe(true);
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "TRUE" })).toBe(true);
  });

  it("PI_WEB_BASH_ENABLED=false → 关闭(大小写不敏感)", () => {
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "false" })).toBe(false);
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "FALSE" })).toBe(false);
  });

  it("PI_WEB_BASH_ENABLED=0 → 关闭", () => {
    expect(resolveBashEnabled({ PI_WEB_BASH_ENABLED: "0" })).toBe(false);
  });
});

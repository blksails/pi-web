/**
 * web-ext-gate-config — 服务端/浏览器门控选项拆分（webext-package-install 任务 1.3）。
 *
 * 核心契约：浏览器选项不含验签材料且 signaturePreVerified；服务端选项持公钥白名单；
 * 默认强制签名。
 */
import { describe, it, expect } from "vitest";
import {
  buildServerGateOptions,
  buildBrowserGateOptions,
} from "../lib/app/web-ext-gate-config.js";

describe("buildServerGateOptions — 服务端持公钥白名单验签", () => {
  it("解析逗号分隔公钥，默认强制签名", () => {
    const o = buildServerGateOptions({ PI_WEB_EXT_WHITELIST: "pubA, pubB" });
    expect(o.whitelist).toEqual(["pubA", "pubB"]);
    expect(o.requireSignature).toBe(true);
  });

  it("PI_WEB_EXT_REQUIRE_SIGNATURE=false 可关闭（dev 逃生门）", () => {
    expect(buildServerGateOptions({ PI_WEB_EXT_REQUIRE_SIGNATURE: "false" }).requireSignature).toBe(false);
  });

  it("默认（env 空）强制签名且白名单为空", () => {
    const o = buildServerGateOptions({});
    expect(o.requireSignature).toBe(true);
    expect(o.whitelist).toEqual([]);
  });
});

describe("buildBrowserGateOptions — 浏览器不含验签材料", () => {
  it("不下发白名单，signaturePreVerified 置真，仅 SRI", () => {
    const o = buildBrowserGateOptions({ PI_WEB_EXT_WHITELIST: "pubA" });
    expect(o.whitelist).toEqual([]); // 验签材料不下发浏览器
    expect(o.signaturePreVerified).toBe(true);
    expect(o.requireSignature).toBe(false);
  });
});

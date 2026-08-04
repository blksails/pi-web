/**
 * 桌面形态默认值裁决(spec desktop-runtime-config 任务 2.2)。
 *
 * 判据选取:
 *  - 「非桌面等价于既有默认」不断言「大致一样」,而是把本特性引入前的两条表达式
 *    **原样重算**再逐字段比对 —— 只有这样才能挡住「顺手统一了两个门控的解析」这类改动,
 *    而那正是最容易发生、且默认值会悄悄翻转的错法(两者语义相反:一个白名单、一个黑名单)。
 *  - 优先级不只测「桌面默认生效」,还要测「env 压得住用户配置」「用户配置压得住桌面默认」
 *    两个方向 —— 只测一级等于没测次序。
 */
import { describe, expect, it } from "vitest";
import {
  DESKTOP_MARKER_ENV,
  isDesktopHost,
  resolveDesktopConfig,
} from "../lib/app/desktop-defaults.js";

const desktopEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  [DESKTOP_MARKER_ENV]: "1",
  ...extra,
});

/** 本特性引入前的两条表达式,原样保留用作对照基线。 */
const legacySourcePicker = (env: NodeJS.ProcessEnv): boolean => {
  const v = env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER;
  return v === "1" || v === "true";
};
const legacyRequireSignature = (env: NodeJS.ProcessEnv): boolean =>
  env.PI_WEB_EXT_REQUIRE_SIGNATURE !== "false";

describe("resolveDesktopConfig", () => {
  it("桌面形态 + 无任何配置 → 选源列表开启、签名要求放宽", () => {
    const r = resolveDesktopConfig({ env: desktopEnv(), userConfig: undefined });
    expect(r.sourcePicker).toBe(true);
    expect(r.requireWebextSignature).toBe(false);
    expect(r.sourcesRoot).toBeUndefined();
  });

  it("非桌面形态 + 无配置 → 与本特性引入前逐字段相等", () => {
    // 覆盖「未设」「显式开」「显式关」三种 env 形态,逐一与旧表达式对照。
    const cases: NodeJS.ProcessEnv[] = [
      {},
      { NEXT_PUBLIC_PI_WEB_SOURCE_PICKER: "1", PI_WEB_EXT_REQUIRE_SIGNATURE: "false" },
      { NEXT_PUBLIC_PI_WEB_SOURCE_PICKER: "0", PI_WEB_EXT_REQUIRE_SIGNATURE: "true" },
      { NEXT_PUBLIC_PI_WEB_SOURCE_PICKER: "true" },
      { PI_WEB_EXT_REQUIRE_SIGNATURE: "false" },
    ];
    for (const env of cases) {
      const r = resolveDesktopConfig({ env, userConfig: undefined });
      expect(r.sourcePicker, `sourcePicker for ${JSON.stringify(env)}`)
        .toBe(legacySourcePicker(env));
      expect(r.requireWebextSignature, `requireSignature for ${JSON.stringify(env)}`)
        .toBe(legacyRequireSignature(env));
    }
  });

  it("env 显式值压过用户配置与桌面默认", () => {
    const r = resolveDesktopConfig({
      env: desktopEnv({
        NEXT_PUBLIC_PI_WEB_SOURCE_PICKER: "0",
        PI_WEB_EXT_REQUIRE_SIGNATURE: "true",
      }),
      userConfig: { sourcePicker: true, requireWebextSignature: false },
    });
    // env 说关就关、说要签名就要 —— 用户配置与桌面默认都让位。
    expect(r.sourcePicker).toBe(false);
    expect(r.requireWebextSignature).toBe(true);
  });

  it("用户配置压过桌面默认(env 未表态时)", () => {
    const r = resolveDesktopConfig({
      env: desktopEnv(),
      userConfig: { sourcePicker: false, requireWebextSignature: true },
    });
    expect(r.sourcePicker).toBe(false);
    expect(r.requireWebextSignature).toBe(true);
  });

  it("用户配置缺失/损坏 → 退回桌面默认,不抛", () => {
    for (const userConfig of [undefined, {} as const]) {
      const r = resolveDesktopConfig({ env: desktopEnv(), userConfig });
      expect(r.sourcePicker).toBe(true);
      expect(r.requireWebextSignature).toBe(false);
    }
  });

  it("空串 env 视为未表态,不吃掉下一级取值", () => {
    // 若把「键存在」当作显式,空串会被解析成 false 而盖掉用户配置 —— 静默且难查。
    //
    // ★ 用户配置必须取**与错误实现的结果相反**的值,否则本用例是重言式:
    //   userConfig 若也填 false,那么「走配置得 false」与「把空串当显式、truthy("  ") 得 false」
    //   殊途同归,判据区分不了两种实现(初版就这么写的,红对照当场抓出它测不到东西)。
    const r = resolveDesktopConfig({
      env: desktopEnv({ NEXT_PUBLIC_PI_WEB_SOURCE_PICKER: "  " }),
      userConfig: { sourcePicker: true },
    });
    expect(r.sourcePicker).toBe(true);

    // 黑名单侧同理:空串不得被当成「非 false」而强制开启签名要求。
    const r2 = resolveDesktopConfig({
      env: desktopEnv({ PI_WEB_EXT_REQUIRE_SIGNATURE: "  " }),
      userConfig: { requireWebextSignature: false },
    });
    expect(r2.requireWebextSignature).toBe(false);
  });

  it("sourcesRoot:空白视为未配置", () => {
    expect(resolveDesktopConfig({ env: desktopEnv(), userConfig: { sourcesRoot: "   " } }).sourcesRoot)
      .toBeUndefined();
    expect(resolveDesktopConfig({ env: desktopEnv(), userConfig: { sourcesRoot: " /tmp/agents " } }).sourcesRoot)
      .toBe("/tmp/agents");
  });

  it("isDesktopHost:仅 \"1\" 算桌面壳", () => {
    expect(isDesktopHost({ [DESKTOP_MARKER_ENV]: "1" })).toBe(true);
    for (const v of ["0", "true", "", undefined]) {
      expect(isDesktopHost(v === undefined ? {} : { [DESKTOP_MARKER_ENV]: v })).toBe(false);
    }
  });
});

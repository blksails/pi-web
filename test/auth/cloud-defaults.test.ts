/**
 * 随包固化的云端默认地址(spec: desktop-account-login,Req 11)。
 *
 * ★ 本文件里最重要的**不是**「桌面下拿得到默认值」,而是那两条防线:
 *   ① 非桌面宿主拿不到 —— 否则每个 `pnpm dev` / npm CLI 用户开机撞登录墙;
 *   ② 用户配置压得住它 —— 否则设置面板改了地址却静默无效。
 * 这两条写错的故障形态都是「看起来能跑,某类用户完全用不了」。
 */
import { describe, it, expect } from "vitest";
import {
  BAKED_CLOUD_EGRESS_BASE,
  DESKTOP_MARKER_ENV,
  DESKTOP_RELEASE_ENV,
  resolveBakedCloudEgressBase,
} from "@/lib/app/cloud-defaults";
import {
  resolveCloudLoginConfig,
  CLOUD_LOGIN_EGRESS_BASE_ENV,
} from "@/lib/app/auth-egress-assembly";

const USER_BASE = "https://user.example/api/desktop/egress/v1";
const ENV_BASE = "https://env.example/api/desktop/egress/v1";

describe("resolveBakedCloudEgressBase — 只对桌面壳生效", () => {
  it("桌面标记为 1 → 返回固化地址", () => {
    expect(resolveBakedCloudEgressBase({ [DESKTOP_MARKER_ENV]: "1" })).toBe(
      BAKED_CLOUD_EGRESS_BASE,
    );
  });

  it.each([
    ["无标记(npm CLI / pnpm dev / 浏览器)", {}],
    ["标记为 0", { [DESKTOP_MARKER_ENV]: "0" }],
    ["标记为空串", { [DESKTOP_MARKER_ENV]: "" }],
    ["标记为其他值", { [DESKTOP_MARKER_ENV]: "true" }],
  ])("%s → undefined(不得让本地用户撞上登录墙)", (_n, env) => {
    expect(resolveBakedCloudEgressBase(env)).toBeUndefined();
  });

  it("固化值本身是合法 http(s) URL —— 否则装配期会 fail-fast,桌面版直接起不来", () => {
    const u = new URL(BAKED_CLOUD_EGRESS_BASE);
    expect(["http:", "https:"]).toContain(u.protocol);
  });
});

describe("★ 三级优先级:env > 用户配置 > 固化默认值", () => {
  const desktop = { [DESKTOP_MARKER_ENV]: "1" };

  it("打包桌面忽略开发用 loopback env,回落生产默认地址", () => {
    const c = resolveCloudLoginConfig(
      {
        ...desktop,
        [DESKTOP_RELEASE_ENV]: "1",
        [CLOUD_LOGIN_EGRESS_BASE_ENV]: "http://127.0.0.1:4100/api/desktop/egress/v1",
      },
      resolveBakedCloudEgressBase(desktop),
    );
    expect(c?.egressBaseUrl).toBe(BAKED_CLOUD_EGRESS_BASE.replace(/\/+$/, ""));
  });

  it("开发桌面仅有通用壳标记时仍允许 loopback cloud", () => {
    const c = resolveCloudLoginConfig(
      {
        ...desktop,
        [CLOUD_LOGIN_EGRESS_BASE_ENV]: "http://127.0.0.1:4100/api/desktop/egress/v1",
      },
      BAKED_CLOUD_EGRESS_BASE,
    );
    expect(c?.egressBaseUrl).toBe("http://127.0.0.1:4100/api/desktop/egress/v1");
  });

  it("三者齐全 → 用 env", () => {
    const baked = resolveBakedCloudEgressBase({ ...desktop });
    const c = resolveCloudLoginConfig(
      { ...desktop, [CLOUD_LOGIN_EGRESS_BASE_ENV]: ENV_BASE },
      USER_BASE ?? baked,
    );
    expect(c?.egressBaseUrl).toBe(ENV_BASE);
  });

  it("★ 有用户配置 → 用用户配置,固化值压不过它(设置面板改了必须生效)", () => {
    const baked = resolveBakedCloudEgressBase(desktop);
    // 装配处的表达式:`readCloudDomainEgressBase(...) ?? resolveBakedCloudEgressBase(...)`
    const fallback = USER_BASE ?? baked;
    expect(fallback).toBe(USER_BASE);
    expect(resolveCloudLoginConfig(desktop, fallback)?.egressBaseUrl).toBe(USER_BASE);
  });

  it("无 env、无用户配置、是桌面 → 用固化值(装完即可登录)", () => {
    const userConfig: string | undefined = undefined;
    const fallback = userConfig ?? resolveBakedCloudEgressBase(desktop);
    expect(resolveCloudLoginConfig(desktop, fallback)?.egressBaseUrl).toBe(
      BAKED_CLOUD_EGRESS_BASE.replace(/\/+$/, ""),
    );
  });

  it("★ 无 env、无用户配置、**非**桌面 → 云端登录整体关闭(行为与本特性引入前一致)", () => {
    const userConfig: string | undefined = undefined;
    const fallback = userConfig ?? resolveBakedCloudEgressBase({});
    expect(fallback).toBeUndefined();
    expect(resolveCloudLoginConfig({}, fallback)).toBeUndefined();
  });
});

/**
 * 本机来源的签名放行判定(spec desktop-runtime-config 任务 4.1,Req 2)。
 *
 * ★ 三个条件缺一不可,故**每个条件都单独有一条否定用例** —— 只测「放行」那条等于没测边界,
 *   而边界正是本特性的安全性所在:无差别放行会让桌面版对 registry 装来的扩展也不验签。
 */
import { describe, expect, it } from "vitest";
import { shouldRelaxSignature } from "../lib/app/webext/build-trust.js";
import { DESKTOP_MARKER_ENV } from "../lib/app/desktop-defaults.js";
import { locateDistWithOrigin } from "../lib/app/webext/locate-dist.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktop: NodeJS.ProcessEnv = { [DESKTOP_MARKER_ENV]: "1" };

describe("shouldRelaxSignature — 三条件缺一不可", () => {
  it("桌面 + 本机目录 + 未表态 → 放行", () => {
    expect(shouldRelaxSignature({ origin: "local", env: desktop, userConfig: undefined }))
      .toBe(true);
  });

  it("非桌面形态 → 不放行(即便来源是本机目录)", () => {
    expect(shouldRelaxSignature({ origin: "local", env: {}, userConfig: undefined }))
      .toBe(false);
  });

  it("非桌面形态 + env 显式关闭签名要求 → 仍不走桌面放行路径", () => {
    // ★ 这条才真正锁住「桌面形态」这个条件。上一条锁不住:非桌面时裁决函数本就返回
    //   requireWebextSignature=true,于是删掉形态检查结果照样是 false —— 两种实现殊途同归
    //   (红对照当场证明了这点)。此处让 env 显式给 false,两条路径的返回值才分道扬镳:
    //   正确实现因形态不符返回 false;漏掉形态检查的实现会返回 true。
    //
    //   语义上也应如此:`shouldRelaxSignature` 回答的是「是否走**桌面**放行路径」。
    //   Web 部署下 env 说不验签,那是既有的全局开关在起作用,不是本特性的放行。
    expect(shouldRelaxSignature({
      origin: "local",
      env: { PI_WEB_EXT_REQUIRE_SIGNATURE: "false" },
      userConfig: undefined,
    })).toBe(false);
  });

  it("来源是已装 npm 包 → 不放行(registry 装来的仍验签)", () => {
    expect(shouldRelaxSignature({ origin: "installed", env: desktop, userConfig: undefined }))
      .toBe(false);
  });

  it("定位不到 dist → 不放行(判不出来就不是显式指定的本机目录)", () => {
    expect(shouldRelaxSignature({ origin: undefined, env: desktop, userConfig: undefined }))
      .toBe(false);
  });

  it("env 显式要求签名 → 不放行(压过桌面默认)", () => {
    expect(shouldRelaxSignature({
      origin: "local",
      env: { ...desktop, PI_WEB_EXT_REQUIRE_SIGNATURE: "true" },
      userConfig: undefined,
    })).toBe(false);
  });

  it("用户在设置里开了签名要求 → 不放行", () => {
    expect(shouldRelaxSignature({
      origin: "local",
      env: desktop,
      userConfig: { requireWebextSignature: true },
    })).toBe(false);
  });

  it("用户显式关闭签名要求 → 放行(与桌面默认同向,但来源仍受限)", () => {
    expect(shouldRelaxSignature({
      origin: "local",
      env: desktop,
      userConfig: { requireWebextSignature: false },
    })).toBe(true);
    // 来源条件不因用户配置而失效。
    expect(shouldRelaxSignature({
      origin: "installed",
      env: desktop,
      userConfig: { requireWebextSignature: false },
    })).toBe(false);
  });
});

describe("locateDistWithOrigin — 来源分类", () => {
  it("本地路径下的 dist → origin=local", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-webext-origin-"));
    try {
      const dist = join(root, "agent", ".pi", "web", "dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, "manifest.json"), "{}", "utf8");
      const located = await locateDistWithOrigin(join(root, "agent"));
      expect(located?.origin).toBe("local");
      expect(located?.distDir).toBe(dist);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("定位不到 → undefined(不误判成任何一类)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-webext-origin-none-"));
    try {
      expect(await locateDistWithOrigin(join(root, "nope"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

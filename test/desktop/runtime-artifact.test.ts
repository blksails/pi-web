/**
 * 桌面壳:运行模式判定 + 产物入口定位单测(spec pi-web-desktop task 2.1)。
 * 覆盖 Req 3.3, 8.1, 8.2, 8.3。纯函数,不触达 electron/进程全局。
 */
import { describe, it, expect } from "vitest";
import {
  resolveRuntimeMode,
  type RuntimeMode,
} from "@/desktop/src/runtime-mode";
import { resolveServerEntry } from "@/desktop/src/resolve-artifact";

describe("resolveRuntimeMode(明确开关,不猜测 — Req 8.3)", () => {
  it("未打包 + 设置 PI_WEB_DESKTOP_DEV_URL → dev(带 devUrl,Req 8.1)", () => {
    const mode = resolveRuntimeMode(
      { PI_WEB_DESKTOP_DEV_URL: "http://localhost:3010" },
      false,
    );
    expect(mode).toEqual({ kind: "dev", devUrl: "http://localhost:3010" });
  });

  it("打包态 → packaged(即使设置了 dev url,打包优先,不误入 dev)", () => {
    const mode = resolveRuntimeMode(
      { PI_WEB_DESKTOP_DEV_URL: "http://localhost:3010" },
      true,
    );
    expect(mode.kind).toBe("packaged");
  });

  it("未打包 + 无 dev url → unpackaged(直跑构建产物,CLI 布局)", () => {
    const mode = resolveRuntimeMode({}, false);
    expect(mode.kind).toBe("unpackaged");
  });

  it("dev url 为空白串 → 不进 dev(需明确非空开关)", () => {
    const mode = resolveRuntimeMode({ PI_WEB_DESKTOP_DEV_URL: "   " }, false);
    expect(mode.kind).toBe("unpackaged");
  });
});

describe("resolveServerEntry(产物入口定位 — Req 3.3, 8.1, 8.2)", () => {
  const deps = {
    resourcesPath: "/Apps/pi-web.app/Contents/Resources",
    cliStandaloneJs: "/repo/.next-cli/standalone/server.js",
  };

  it("packaged → 资源目录下 standalone/server.js(Req 3.3)", () => {
    const entry = resolveServerEntry({ kind: "packaged" }, deps);
    expect(entry).toBe(
      "/Apps/pi-web.app/Contents/Resources/standalone/server.js",
    );
  });

  it("unpackaged → CLI 布局 standalone 入口(Req 8.2)", () => {
    const entry = resolveServerEntry({ kind: "unpackaged" }, deps);
    expect(entry).toBe("/repo/.next-cli/standalone/server.js");
  });

  it("dev → null(壳改加载 dev url,不拉起 server — Req 8.1)", () => {
    const mode: RuntimeMode = { kind: "dev", devUrl: "http://localhost:3010" };
    expect(resolveServerEntry(mode, deps)).toBeNull();
  });

  it("packaged 但缺 resourcesPath → 抛错(定位失败须显式,而非静默错误路径)", () => {
    expect(() =>
      resolveServerEntry(
        { kind: "packaged" },
        { resourcesPath: undefined, cliStandaloneJs: deps.cliStandaloneJs },
      ),
    ).toThrow(/resourcesPath/);
  });
});

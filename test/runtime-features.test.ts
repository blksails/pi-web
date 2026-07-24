/**
 * 运行时门控源(spec vite-spa-migration,Req 2.2)。
 *
 * 三条性质:
 *  1. 注入优先(SPA:bootstrap 下发)。
 *  2. 未注入时回退 env(旧宿主 Next),且与迁移前 `chat-app.tsx` 的判定逐字段等价。
 *  3. 浏览器里 `process` 是**未定义标识符**,回退路径必须守卫,不能抛 ReferenceError。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRuntimeFeatures,
  resetRuntimeFeatures,
  setRuntimeFeatures,
  type RuntimeFeatures,
} from "@/lib/app/runtime-features";

const INJECTED: RuntimeFeatures = {
  canvas: true,
  sourcePicker: true,
  launcherRail: true,
  bashEnabled: true,
  sessionsGlobal: true,
  sessionsManage: false,
  sessionsSlot: "header",
  extensionCommands: "all",
  extensionAllowlist: "foo,bar",
  extensionBaseUrl: "https://x.test/",
  disableReadinessHandshake: true,
};

afterEach(() => {
  resetRuntimeFeatures();
  vi.unstubAllEnvs();
});

describe("runtime-features", () => {
  it("注入后优先返回注入值", () => {
    setRuntimeFeatures(INJECTED);
    expect(getRuntimeFeatures()).toEqual(INJECTED);
  });

  it("未注入时回退 env", () => {
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_CANVAS", "1");
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT", "footer");
    vi.stubEnv("NEXT_PUBLIC_PI_EXTENSION_COMMANDS", "all");
    const f = getRuntimeFeatures();
    expect(f.canvas).toBe(true);
    expect(f.sessionsSlot).toBe("footer");
    expect(f.extensionCommands).toBe("all");
  });

  it("sessionsManage 默认启用,仅显式 false/0 关闭", () => {
    expect(getRuntimeFeatures().sessionsManage).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE", "false");
    expect(getRuntimeFeatures().sessionsManage).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE", "0");
    expect(getRuntimeFeatures().sessionsManage).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE", "anything-else");
    expect(getRuntimeFeatures().sessionsManage).toBe(true);
  });

  it("truthy 门控只认 '1' 与 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_CANVAS", "true");
    expect(getRuntimeFeatures().canvas).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_PI_WEB_CANVAS", "yes");
    expect(getRuntimeFeatures().canvas).toBe(false);
  });

  it("缺省值:未设 env 时门控关闭、slot 为 sidebar", () => {
    const f = getRuntimeFeatures();
    expect(f.canvas).toBe(false);
    expect(f.launcherRail).toBe(false);
    expect(f.bashEnabled).toBe(false);
    expect(f.sessionsSlot).toBe("sidebar");
    expect(f.extensionBaseUrl).toBe("");
  });

  it("`process` 未定义时(浏览器)回退路径不抛,返回全默认", () => {
    const saved = globalThis.process;
    // @ts-expect-error 模拟浏览器:`process` 不存在
    delete globalThis.process;
    try {
      expect(() => getRuntimeFeatures()).not.toThrow();
      expect(getRuntimeFeatures().sessionsSlot).toBe("sidebar");
    } finally {
      globalThis.process = saved;
    }
  });
});

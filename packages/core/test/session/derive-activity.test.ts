/**
 * deriveActivity(spec session-meta-index, 任务 2.2 / Req 7.1-7.4, 7.7)。
 *
 * ★ 最关键的一条是「挂起表里只有推送类 → 空闲」:服务端挂起表**确实**会混入
 *   notify/setTitle 等永不回包的请求,若不过滤,发过一次通知的会话会永久显示「等待用户交互」。
 *   该用例在派生逻辑去掉 method 过滤后必红。
 */
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_EXTENSION_UI_METHODS,
  PUSH_EXTENSION_UI_METHODS,
  type SessionLifecycleState,
} from "@blksails/pi-web-protocol";
import { deriveActivity } from "../../src/session/derive-activity.js";

const LIFECYCLES: readonly SessionLifecycleState[] = [
  "initializing",
  "ready",
  "error",
  "ended",
];

describe("deriveActivity 基本取值", () => {
  it("空闲会话返回 undefined(列表据此省略字段)", () => {
    expect(
      deriveActivity({ busy: false, lifecycle: "ready", pendingMethods: [] }),
    ).toBeUndefined();
  });

  it("轮次进行中 → working", () => {
    expect(
      deriveActivity({ busy: true, lifecycle: "ready", pendingMethods: [] }),
    ).toBe("working");
  });

  it("lifecycle=error → error(即使不忙)", () => {
    expect(
      deriveActivity({ busy: false, lifecycle: "error", pendingMethods: [] }),
    ).toBe("error");
  });

  it("initializing / ended 不产生指示(本期只显示三态)", () => {
    for (const lifecycle of ["initializing", "ended"] as const) {
      expect(
        deriveActivity({ busy: false, lifecycle, pendingMethods: [] }),
      ).toBeUndefined();
    }
  });
});

describe("method 过滤(Req 7.2)", () => {
  it("每一种交互类挂起都产生 awaiting-input", () => {
    for (const method of INTERACTIVE_EXTENSION_UI_METHODS) {
      expect(
        deriveActivity({
          busy: true,
          lifecycle: "ready",
          pendingMethods: [method],
        }),
        `交互类 ${method} 应判为等待用户`,
      ).toBe("awaiting-input");
    }
  });

  it("★ 只有推送类挂起时判为空闲(不误报等待用户)", () => {
    for (const method of PUSH_EXTENSION_UI_METHODS) {
      expect(
        deriveActivity({
          busy: false,
          lifecycle: "ready",
          pendingMethods: [method],
        }),
        `推送类 ${method} 不得判为等待用户`,
      ).toBeUndefined();
    }
    // 全部推送类同时滞留(真实会话跑久了就是这样)也仍是空闲
    expect(
      deriveActivity({
        busy: false,
        lifecycle: "ready",
        pendingMethods: [...PUSH_EXTENSION_UI_METHODS],
      }),
    ).toBeUndefined();
  });

  it("推送类与交互类混杂时仍按交互类判定", () => {
    expect(
      deriveActivity({
        busy: true,
        lifecycle: "ready",
        pendingMethods: [...PUSH_EXTENSION_UI_METHODS, "confirm"],
      }),
    ).toBe("awaiting-input");
  });

  it("未知 method 归非交互(失败安全)", () => {
    expect(
      deriveActivity({
        busy: false,
        lifecycle: "ready",
        pendingMethods: ["someFutureMethod"],
      }),
    ).toBeUndefined();
  });
});

describe("优先级穷举(Req 7.4)", () => {
  it("awaiting-input > error > working > 空闲,覆盖全部输入组合", () => {
    const pendingSets: readonly (readonly string[])[] = [
      [],
      ["notify"],
      ["select"],
      ["notify", "input"],
    ];
    for (const busy of [false, true]) {
      for (const lifecycle of LIFECYCLES) {
        for (const pendingMethods of pendingSets) {
          const got = deriveActivity({ busy, lifecycle, pendingMethods });
          const hasInteractive = pendingMethods.some((m) =>
            (INTERACTIVE_EXTENSION_UI_METHODS as readonly string[]).includes(m),
          );
          const expected = hasInteractive
            ? "awaiting-input"
            : lifecycle === "error"
              ? "error"
              : busy
                ? "working"
                : undefined;
          expect(got, `busy=${busy} lifecycle=${lifecycle} pending=${pendingMethods.join()}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it("等待用户交互压过工作中(交互期间 busy 仍为 true)", () => {
    expect(
      deriveActivity({ busy: true, lifecycle: "ready", pendingMethods: ["confirm"] }),
    ).toBe("awaiting-input");
  });

  it("异常压过工作中", () => {
    expect(
      deriveActivity({ busy: true, lifecycle: "error", pendingMethods: [] }),
    ).toBe("error");
  });

  it("相同输入恒等输出(纯函数)", () => {
    const input = {
      busy: true,
      lifecycle: "ready" as const,
      pendingMethods: ["editor"],
    };
    expect(deriveActivity(input)).toBe(deriveActivity(input));
  });
});

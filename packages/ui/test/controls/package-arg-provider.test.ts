/**
 * createPackageArgProvider 集成单测(mock fetch,spec agent-plugin-commands 任务 3.2;
 * 迁自 install-arg-provider.test.ts 并按两条命令的分道重组)。
 */
import { describe, it, expect, vi } from "vitest";
import { createPackageArgProvider } from "../../src/controls/package-arg-provider.js";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

function makeProvider(fetchImpl: unknown) {
  return createPackageArgProvider({
    baseUrl: "http://x",
    sessionId: "s1",
    fetchImpl: fetchImpl as typeof fetch,
  });
}

describe("createPackageArgProvider — spec 分道", () => {
  it("同时识别 agent 与 plugin,子动作集合各不相同", () => {
    const p = makeProvider(vi.fn());
    // publish 于 spec publish-host-command 加入两条命令(发布前预览)。
    expect(p.specFor("agent")?.subcommands.map((s) => s.name)).toEqual([
      "install",
      "uninstall",
      "list",
      "publish",
    ]);
    expect(p.specFor("plugin")?.subcommands.map((s) => s.name)).toEqual([
      "install",
      "uninstall",
      "list",
      "update",
      "publish",
    ]);
  });

  it("不识别其他命令(含已摘除的 install)", () => {
    const p = makeProvider(vi.fn());
    expect(p.specFor("install")).toBeUndefined();
    expect(p.specFor("other")).toBeUndefined();
  });

  it("每个子动作都声明了 i18n 说明键(面板据此渲染中文说明)", () => {
    const p = makeProvider(vi.fn());
    for (const cmd of ["agent", "plugin"] as const) {
      for (const s of p.specFor(cmd)?.subcommands ?? []) {
        expect(s.descriptionKey).toBe(`commandArg.${cmd}.${s.name}`);
      }
    }
  });
});

describe("createPackageArgProvider — 候选来源分道", () => {
  it("两条命令的 install 都取本地来源候选", async () => {
    for (const cmd of ["agent", "plugin"] as const) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          sources: [{ path: "./examples/a", insertText: "local:./examples/a" }],
        }),
      );
      const items = await makeProvider(fetchImpl).listArgs(cmd, "install", "ex");
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://x/sessions/s1/install-sources?q=ex",
        expect.anything(),
      );
      expect(items[0]?.insertText).toBe("local:./examples/a");
    }
  });

  it("agent uninstall 只打 /agent-sources,insertText 不含类别参数", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ sources: [{ id: "/abs/path/my-agent", name: "my-agent" }] }),
    );
    const items = await makeProvider(fetchImpl).listArgs("agent", "uninstall", "");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://x/agent-sources", expect.anything());
    // 拆分前这里是 "/abs/path/my-agent --kind agent" —— 命令名锁定类别后该补丁消失。
    expect(items[0]?.insertText).toBe("/abs/path/my-agent");
    expect(items[0]?.insertText).not.toContain("--kind");
    expect(items[0]?.detail).toBe("agent");
  });

  it("plugin uninstall 与 update 只打 /extensions", async () => {
    for (const sub of ["uninstall", "update"] as const) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ extensions: [{ id: "npm:pi-web-access", kind: "npm" }] }),
      );
      const items = await makeProvider(fetchImpl).listArgs("plugin", sub, "");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith("http://x/extensions", expect.anything());
      expect(items.map((i) => i.id)).toEqual(["npm:pi-web-access"]);
    }
  });

  it("plugin 候选过滤噪声行(表头/绝对路径),仅留包标识", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        extensions: [
          { id: "User packages:", kind: "npm" },
          { id: "npm:pi-web-access", kind: "npm" },
          { id: "/Users/x/.pi/agent/npm/node_modules/pi-web-access", kind: "local" },
        ],
      }),
    );
    const items = await makeProvider(fetchImpl).listArgs("plugin", "uninstall", "");
    expect(items.map((i) => i.id)).toEqual(["npm:pi-web-access"]);
  });

  it("终态 list 无参数源 → 空,且不发请求", async () => {
    const fetchImpl = vi.fn();
    const p = makeProvider(fetchImpl);
    expect(await p.listArgs("agent", "list", "")).toEqual([]);
    expect(await p.listArgs("plugin", "list", "")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("未知命令 → 空,且不发请求", async () => {
    const fetchImpl = vi.fn();
    expect(await makeProvider(fetchImpl).listArgs("install", "install", "")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("HTTP 失败 → 空(收敛,不阻断输入)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false));
    const p = makeProvider(fetchImpl);
    expect(await p.listArgs("plugin", "update", "")).toEqual([]);
    expect(await p.listArgs("agent", "uninstall", "")).toEqual([]);
    expect(await p.listArgs("agent", "install", "")).toEqual([]);
  });
});

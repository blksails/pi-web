/**
 * createInstallArgProvider 集成单测(mock fetch,spec install-host-command 任务 3.3)。
 */
import { describe, it, expect, vi } from "vitest";
import { createInstallArgProvider } from "../../src/controls/install-arg-provider.js";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("createInstallArgProvider", () => {
  it("specFor 仅识别 install,四子动作齐全", () => {
    const p = createInstallArgProvider({
      baseUrl: "http://x",
      sessionId: "s1",
      fetchImpl: vi.fn(),
    });
    const spec = p.specFor("install");
    expect(spec?.command).toBe("install");
    expect(spec?.subcommands.map((s) => s.name)).toEqual([
      "install",
      "uninstall",
      "list",
      "update",
    ]);
    expect(p.specFor("other")).toBeUndefined();
  });

  it("install → GET /sessions/:id/install-sources,映射 local: insertText", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        sources: [{ path: "./examples/a", insertText: "local:./examples/a" }],
      }),
    );
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("install", "install", "ex");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://x/sessions/s1/install-sources?q=ex",
      expect.anything(),
    );
    expect(items[0]?.insertText).toBe("local:./examples/a");
  });

  it("uninstall → 合并 /extensions 与 /agent-sources,agent 项 insertText 带 --kind agent", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/extensions")) {
        return jsonResponse({ extensions: [{ id: "npm:pi-web-access", kind: "npm" }] });
      }
      if (url.endsWith("/agent-sources")) {
        return jsonResponse({ sources: [{ id: "/abs/path/my-agent", name: "my-agent" }] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("install", "uninstall", "");
    expect(fetchImpl).toHaveBeenCalledWith("http://x/extensions", expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith("http://x/agent-sources", expect.anything());
    const plugin = items.find((i) => i.id === "npm:pi-web-access");
    expect(plugin?.insertText).toBe("npm:pi-web-access");
    const agent = items.find((i) => i.id === "/abs/path/my-agent");
    expect(agent?.insertText).toBe("/abs/path/my-agent --kind agent");
    expect(agent?.detail).toBe("agent");
  });

  it("uninstall 过滤噪声行(表头/绝对路径的插件端),仅留包标识", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/extensions")) {
        return jsonResponse({
          extensions: [
            { id: "User packages:", kind: "npm" },
            { id: "npm:pi-web-access", kind: "npm" },
            { id: "/Users/x/.pi/agent/npm/node_modules/pi-web-access", kind: "local" },
          ],
        });
      }
      return jsonResponse({ sources: [] });
    });
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("install", "uninstall", "");
    expect(items.map((i) => i.id)).toEqual(["npm:pi-web-access"]);
  });

  it("update → 仅 GET /extensions(不合并 agent-sources)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ extensions: [{ id: "npm:pi-web-access", kind: "npm" }] }),
    );
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("install", "update", "");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://x/extensions", expect.anything());
    expect(items.map((i) => i.id)).toEqual(["npm:pi-web-access"]);
  });

  it("终态 list 无参数源 → 空", async () => {
    const fetchImpl = vi.fn();
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    expect(await p.listArgs("install", "list", "")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("HTTP 失败 → 空(收敛)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false));
    const p = createInstallArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    expect(await p.listArgs("install", "update", "")).toEqual([]);
    expect(await p.listArgs("install", "uninstall", "")).toEqual([]);
  });
});

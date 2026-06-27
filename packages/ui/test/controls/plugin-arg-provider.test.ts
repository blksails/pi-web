/**
 * createPluginArgProvider 集成单测(mock fetch)。
 */
import { describe, it, expect, vi } from "vitest";
import { createPluginArgProvider } from "../../src/controls/plugin-arg-provider.js";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe("createPluginArgProvider", () => {
  it("specFor 仅识别 plugin", () => {
    const p = createPluginArgProvider({
      baseUrl: "http://x",
      sessionId: "s1",
      fetchImpl: vi.fn(),
    });
    expect(p.specFor("plugin")?.command).toBe("plugin");
    expect(p.specFor("other")).toBeUndefined();
  });

  it("uninstall → GET /extensions,映射 id,按 query 过滤", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        extensions: [
          { id: "@a/ext", kind: "npm" },
          { id: "@b/tool", kind: "git" },
        ],
      }),
    );
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("plugin", "uninstall", "tool");
    expect(fetchImpl).toHaveBeenCalledWith("http://x/extensions", expect.anything());
    expect(items.map((i) => i.id)).toEqual(["@b/tool"]);
    expect(items[0]?.insertText).toBe("@b/tool");
  });

  it("uninstall 过滤噪声行(表头/绝对路径),仅留包标识", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        extensions: [
          { id: "User packages:", kind: "npm" },
          { id: "npm:pi-web-access", kind: "npm" },
          { id: "/Users/x/.pi/agent/npm/node_modules/pi-web-access", kind: "local" },
          { id: "npm:pi-sandbox", kind: "npm" },
        ],
      }),
    );
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("plugin", "uninstall", "");
    expect(items.map((i) => i.id)).toEqual(["npm:pi-web-access", "npm:pi-sandbox"]);
  });

  it("install → GET /sessions/:id/install-sources,映射 local: insertText", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        sources: [{ path: "./examples/a", insertText: "local:./examples/a" }],
      }),
    );
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    const items = await p.listArgs("plugin", "install", "ex");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://x/sessions/s1/install-sources?q=ex",
      expect.anything(),
    );
    expect(items[0]?.insertText).toBe("local:./examples/a");
  });

  it("别名 add 走 install 数据源;remove 走 uninstall", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sources: [], extensions: [] }));
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    await p.listArgs("plugin", "add", "");
    expect(fetchImpl).toHaveBeenLastCalledWith(
      expect.stringContaining("/install-sources"),
      expect.anything(),
    );
    await p.listArgs("plugin", "remove", "");
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "http://x/extensions",
      expect.anything(),
    );
  });

  it("终态 list 无参数源 → 空", async () => {
    const fetchImpl = vi.fn();
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    expect(await p.listArgs("plugin", "list", "")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("HTTP 失败 → 空(收敛)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false));
    const p = createPluginArgProvider({ baseUrl: "http://x", sessionId: "s1", fetchImpl });
    expect(await p.listArgs("plugin", "uninstall", "")).toEqual([]);
  });
});

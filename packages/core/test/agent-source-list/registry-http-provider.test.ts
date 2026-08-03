/**
 * RegistryHttpSourceProvider 单测(desktop-hybrid-agent-sources)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createRegistryHttpSourceProvider,
  type RegistryFetch,
  type SourcesGrant,
} from "../../src/agent-source-list/registry-http-provider.js";

function jsonResponse(status: number, body: unknown): Awaited<ReturnType<RegistryFetch>> {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("createRegistryHttpSourceProvider", () => {
  it("无 grant → 空列表且不发请求", async () => {
    const fetchImpl = vi.fn<RegistryFetch>();
    const p = createRegistryHttpSourceProvider({
      getGrant: async () => undefined,
      fetchImpl,
    });
    await expect(p.list()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("成功投影 agent 为 id@channel,滤 plugin", async () => {
    const fetchImpl = vi.fn<RegistryFetch>(async () =>
      jsonResponse(200, {
        sources: [
          {
            id: "acme/bot",
            displayName: "Acme Bot",
            description: "hello",
            kind: "agent",
          },
          {
            id: "acme/theme",
            displayName: "Theme Pack",
            kind: "plugin",
          },
          {
            id: "acme/wip",
            displayName: "WIP",
            // kind 未定:仍列入
          },
        ],
      }),
    );
    const grant: SourcesGrant = {
      baseUrl: "https://registry.example/v1",
      token: "secret-token-should-not-appear-in-records",
    };
    const p = createRegistryHttpSourceProvider({
      getGrant: async () => grant,
      fetchImpl,
    });
    const recs = await p.list();
    expect(recs.map((r) => r.id).sort()).toEqual(["acme/bot", "acme/wip"]);
    const bot = recs.find((r) => r.id === "acme/bot")!;
    expect(bot.source).toBe("acme/bot@stable");
    expect(bot.origin).toBe("registry");
    expect(bot.kind).toBe("dir");
    expect(bot.mode).toBe("cli");
    expect(bot.name).toBe("Acme Bot");
    expect(bot.title).toBe("Acme Bot");
    expect(bot.description).toBe("hello");
    // 响应记录不得携带 token
    expect(JSON.stringify(recs)).not.toContain("secret-token");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://registry.example/v1/sources");
    expect(init.headers.authorization).toBe("Bearer secret-token-should-not-appear-in-records");
  });

  it("401 / 网络失败 → [] 不抛", async () => {
    const p401 = createRegistryHttpSourceProvider({
      getGrant: async () => ({ baseUrl: "https://r.example", token: "t" }),
      fetchImpl: async () => jsonResponse(401, { error: "nope" }),
    });
    await expect(p401.list()).resolves.toEqual([]);

    const pNet = createRegistryHttpSourceProvider({
      getGrant: async () => ({ baseUrl: "https://r.example", token: "t" }),
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    await expect(pNet.list()).resolves.toEqual([]);
  });

  it("getGrant 抛错 → []", async () => {
    const p = createRegistryHttpSourceProvider({
      getGrant: async () => {
        throw new Error("boom");
      },
      fetchImpl: vi.fn(),
    });
    await expect(p.list()).resolves.toEqual([]);
  });
});

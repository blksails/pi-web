import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SearchPlatformClient } from "../platform.js";
import { createSearchMcpTools } from "./mcp.js";
import {
  createSearchToolDefinitions,
  makeSearchToolsExtension,
} from "./tools.js";

function fakeClient(): SearchPlatformClient {
  return {
    available: true,
    searchCreatives: vi.fn(async (input) => ({
      items: [{ id: "material:1", similarity: 0.98, input }],
    })),
  };
}

describe("search AI adapters", () => {
  it("MCP 与 CustomTool 共用 creative_search schema", () => {
    const client = fakeClient();
    const custom = createSearchToolDefinitions(client);
    const mcp = createSearchMcpTools(client);
    expect(mcp.map(({ name }) => name)).toEqual(["creative_search"]);
    expect(JSON.stringify(mcp[0]?.parameters)).toBe(JSON.stringify(custom[0]?.parameters));
  });

  it("以词/图调用 webapp similar-search 契约", async () => {
    const client = fakeClient();
    const tool = createSearchToolDefinitions(client)[0]!;
    await expect(tool.execute({ text: "海报", limit: 3 })).resolves.toMatchObject({
      ok: true,
      items: [{ id: "material:1" }],
    });
    await expect(tool.execute({ image_url: "data:image/jpeg;base64,AA==" }))
      .resolves.toMatchObject({ ok: true });
    expect(client.searchCreatives).toHaveBeenNthCalledWith(1, { text: "海报", limit: 3 });
    expect(client.searchCreatives).toHaveBeenNthCalledWith(2, {
      imageDataUri: "data:image/jpeg;base64,AA==",
      limit: 60,
    });
  });

  it("默认注册进程内工具，禁用项可关闭", () => {
    const registered: string[] = [];
    const pi = {
      registerTool: (definition: { name: string }) => registered.push(definition.name),
    } as unknown as ExtensionAPI;
    makeSearchToolsExtension({}, fakeClient())(pi);
    expect(registered).toEqual(["creative_search"]);
    makeSearchToolsExtension({ PI_LABS_SEARCH_AI_ADAPTER: "disabled" }, fakeClient())(pi);
    expect(registered).toEqual(["creative_search"]);
  });
});

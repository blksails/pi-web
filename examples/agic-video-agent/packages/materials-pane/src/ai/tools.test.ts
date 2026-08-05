import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MaterialsApplicationService } from "../application/index.js";
import { createMaterialsMcpTools } from "./mcp.js";
import {
  createMaterialsToolDefinitions,
  makeMaterialsToolsExtension,
} from "./tools.js";

function fakeService(): MaterialsApplicationService {
  return {
    query: vi.fn(async () => ({ items: [], requestId: "req-read" })),
    execute: vi.fn(async () => ({
      changedIds: ["9"],
      requestId: "req-write",
      refresh: {
        resource: "enterprise-materials" as const,
        strategy: "reload" as const,
        revision: 1,
      },
    })),
  };
}

describe("materials AI adapters", () => {
  it("MCP 与 CustomTools 同源复用六个 schema", () => {
    const service = fakeService();
    const custom = createMaterialsToolDefinitions(service);
    const mcp = createMaterialsMcpTools(service);
    expect(mcp.map(({ name }) => name)).toEqual(custom.map(({ name }) => name));
    expect(mcp.map(({ parameters }) => JSON.stringify(parameters)))
      .toEqual(custom.map(({ parameters }) => JSON.stringify(parameters)));
    expect(custom.map(({ name }) => name)).toEqual([
      "materials_search",
      "materials_get",
      "materials_status",
      "materials_manage",
      "materials_locate",
      "materials_distribute",
    ]);
  });

  it("默认保留 MCP 单入口；显式切换才注册 CustomTools", () => {
    const registered: string[] = [];
    const pi = {
      registerTool: (definition: { name: string }) => registered.push(definition.name),
    } as unknown as ExtensionAPI;
    makeMaterialsToolsExtension({}, fakeService())(pi);
    expect(registered).toEqual([]);
    makeMaterialsToolsExtension(
      { PI_LABS_MATERIALS_AI_ADAPTER: "custom-tools" },
      fakeService(),
    )(pi);
    expect(registered).toHaveLength(6);
  });

  it("工具结果携稳定 requestId 与 Pane 刷新提示", async () => {
    const service = fakeService();
    const distribute = createMaterialsToolDefinitions(service)
      .find(({ name }) => name === "materials_distribute");
    expect(distribute).toBeDefined();
    await expect(distribute!.execute({
      ids: [9],
      advertiserIds: [1],
      confirmed: true,
      idempotencyKey: "dist-9",
    })).resolves.toMatchObject({
      ok: true,
      requestId: "req-write",
      refresh: { resource: "enterprise-materials", strategy: "reload" },
    });
    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: "distribute",
      ids: ["9"],
      advertiserIds: ["1"],
    }));
  });
});

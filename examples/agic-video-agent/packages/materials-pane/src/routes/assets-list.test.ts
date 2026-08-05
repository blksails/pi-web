import { describe, expect, it, vi } from "vitest";
import type { AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import type { MaterialsPlatformClient } from "../platform.js";
import {
  createAssetsListHandler,
  type AssetsListDependencies,
} from "./assets-list.js";

const attachment = {
  id: "att_local",
  mimeType: "image/png",
  name: "local.png",
  createdAt: "2026-07-29T00:00:00Z",
  origin: "tool-output",
};

function request(query: Record<string, string> = {}): AgentRouteRequest {
  return { method: "GET", query } as AgentRouteRequest;
}

function getAttachments(): NonNullable<AssetsListDependencies["getAttachments"]> {
  return (() => ({
    available: true,
    listBySession: async () => [attachment],
    getMeta: async () => undefined,
    resolve: async () => ({ url: async () => "https://cdn.example/local.png" }),
  })) as unknown as NonNullable<AssetsListDependencies["getAttachments"]>;
}

describe("assets-list route", () => {
  it("平台素材与会话附件按 attachmentId 合并去重", async () => {
    const listAssets = vi.fn(async () => ({
      items: [
        { assetId: "remote", attachmentId: "att_remote", displayUrl: "https://cdn.example/remote.png" },
        { assetId: "local-copy", attachmentId: "att_local", displayUrl: "https://cdn.example/local-copy.png" },
      ],
    }));
    const platform: MaterialsPlatformClient = {
      available: true,
      listAssets,
      listMaterialStatus: async () => ({ items: [] }),
    };
    const handler = createAssetsListHandler({
      getAttachments: getAttachments(),
      getPlatform: () => platform,
    });

    const result = await handler(request()) as { items: Array<{ attachmentId: string }> };
    expect(result.items.map(({ attachmentId }) => attachmentId)).toEqual([
      "att_remote",
      "att_local",
    ]);
  });

  it("scope=session 只读当前会话附件，不触达平台", async () => {
    const listAssets = vi.fn();
    const base = getAttachments()();
    const handler = createAssetsListHandler({
      getAttachments: (() => ({
        ...base,
        getMeta: async () => ({ materialId: "material-9" }),
      })) as NonNullable<AssetsListDependencies["getAttachments"]>,
      getPlatform: () => ({
        available: true,
        listAssets,
        listMaterialStatus: async () => ({ items: [] }),
      }),
    });

    const result = await handler(request({ scope: "session" })) as {
      source: string;
      items: Array<{ attachmentId: string; meta?: { materialId?: string } }>;
    };
    expect(result.source).toBe("session-attachments");
    expect(result.items.map(({ attachmentId }) => attachmentId)).toEqual(["att_local"]);
    expect(result.items[0]?.meta?.materialId).toBe("material-9");
    expect(listAssets).not.toHaveBeenCalled();
  });

  it("从素材库移除的附件不再展示", async () => {
    const base = getAttachments()();
    const handler = createAssetsListHandler({
      getAttachments: (() => ({
        ...base,
        getMeta: async () => ({ materialsLibraryHidden: true }),
      })) as NonNullable<AssetsListDependencies["getAttachments"]>,
      getPlatform: () => ({
        available: false,
        listAssets: vi.fn(),
        listMaterialStatus: async () => ({ items: [] }),
      }),
    });

    const result = await handler(request({ scope: "session" })) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });
});

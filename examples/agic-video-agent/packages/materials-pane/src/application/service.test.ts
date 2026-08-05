import { describe, expect, it, vi } from "vitest";
import {
  MaterialsApplicationError,
  type MaterialsAuditRecord,
} from "./contracts.js";
import {
  createMaterialsApplicationService,
  materialsApiUrl,
} from "./service.js";

const ENV = {
  PI_LABS_WEBAPP_URL: "http://127.0.0.1:4000",
  PI_WEB_DESKTOP_CREDENTIAL: "tenant-session",
  PI_WEB_SESSION_ID: "session-1",
} as NodeJS.ProcessEnv;

function serviceWith(
  fetch: typeof globalThis.fetch,
  extras: {
    readonly audit?: (record: MaterialsAuditRecord) => void;
    readonly requestId?: () => string;
  } = {},
) {
  return createMaterialsApplicationService({
    env: ENV,
    fetch,
    audit: extras.audit ?? (() => {}),
    requestId: extras.requestId ?? (() => "req-1"),
    now: () => "2026-07-29T00:00:00.000Z",
  });
}

describe("MaterialsApplicationService", () => {
  it("企业未登录在出网前返回 401", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const service = createMaterialsApplicationService({
      env: { PI_LABS_WEBAPP_URL: "http://127.0.0.1:4000" },
      fetch,
      audit: () => {},
    });
    await expect(service.query({ kind: "search" })).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
  ] as const)("BFF %i 映射为稳定错误 %s", async (status, code) => {
    const service = serviceWith(async () =>
      Response.json({ error: { message: "denied" } }, { status }));
    await expect(service.query({ kind: "search" })).rejects.toMatchObject({
      code,
      status,
    });
  });

  it("开发态无显式配置时只指向本地素材 BFF", () => {
    expect(materialsApiUrl({}).href).toBe(
      "http://127.0.0.1:4000/api/agent/materials",
    );
  });

  it.each([
    [
      async () => new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      "invalid_webapp_response",
      502,
    ],
    [
      async () => { throw new Error("offline"); },
      "webapp_unavailable",
      503,
    ],
  ] as const)("非 JSON 与断网收敛为稳定可重试错误", async (fetch, code, status) => {
    const service = serviceWith(fetch);
    await expect(service.query({ kind: "search" })).rejects.toMatchObject({
      code,
      status,
      retryable: true,
    });
  });

  it("删除须显式确认与幂等键", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const service = serviceWith(fetch);
    await expect(service.execute({
      kind: "delete-materials",
      ids: ["9"],
      confirmed: false as never,
      idempotencyKey: "",
    })).rejects.toMatchObject({ code: "confirmation_required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("同一幂等键与命令只写一次，并回放同一 requestId", async () => {
    const records: MaterialsAuditRecord[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization"))
        .toBe("Bearer tenant-session");
      expect(new Headers(init?.headers).get("x-idempotency-key")).toBe("delete-9");
      expect(new Headers(init?.headers).get("x-materials-confirmed")).toBe("true");
      expect(JSON.parse(String(init?.body))).toEqual({ op: "delete", ids: ["9"] });
      return Response.json({ deleted: ["9"] });
    });
    const service = serviceWith(fetch, {
      audit: (record) => records.push(record),
      requestId: () => "req-delete-9",
    });
    const command = {
      kind: "delete-materials" as const,
      ids: ["9"],
      confirmed: true as const,
      idempotencyKey: "delete-9",
    };
    const first = await service.execute(command);
    const replay = await service.execute(command);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      requestId: "req-delete-9",
      refresh: { resource: "enterprise-materials", strategy: "reload" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(records).toEqual([expect.objectContaining({
      requestId: "req-delete-9",
      operation: "delete-materials",
      outcome: "success",
      entityIds: ["9"],
    })]);
  });

  it("同一幂等键不可换作另一命令", async () => {
    const service = serviceWith(async () => Response.json({ ok: true }));
    await service.execute({
      kind: "delete-materials",
      ids: ["9"],
      confirmed: true,
      idempotencyKey: "same-key",
    });
    await expect(service.execute({
      kind: "delete-materials",
      ids: ["10"],
      confirmed: true,
      idempotencyKey: "same-key",
    })).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
  });

  it("失败写也记审计且不记录名称、凭据", async () => {
    const records: MaterialsAuditRecord[] = [];
    const service = serviceWith(
      async () => Response.json(
        { error: { code: "forbidden", message: "no permission" } },
        { status: 403 },
      ),
      { audit: (record) => records.push(record) },
    );
    await expect(service.execute({
      kind: "rename-folder",
      id: "folder-1",
      name: "secret-name",
    })).rejects.toBeInstanceOf(MaterialsApplicationError);
    expect(records).toEqual([expect.objectContaining({
      operation: "rename-folder",
      outcome: "failure",
      errorCode: "forbidden",
      entityIds: ["folder-1"],
    })]);
    expect(JSON.stringify(records)).not.toContain("secret-name");
    expect(JSON.stringify(records)).not.toContain("tenant-session");
  });

  it("查询返回稳定素材 ID 与可审计 requestId", async () => {
    const service = serviceWith(async () => Response.json({
      items: [{
        id: 9,
        name: "hero.png",
        type: "IMAGE",
        file_url: "http://127.0.0.1:4000/uploads/hero.png",
      }],
      total: 1,
    }), { requestId: () => "req-search" });
    await expect(service.query({ kind: "search", materialKind: "image" }))
      .resolves.toMatchObject({
        requestId: "req-search",
        total: 1,
        items: [{ assetId: "material:9", meta: { materialId: "9" } }],
      });
  });

  it("目录元数据失败时降级加载真实素材", async () => {
    const urls: URL[] = [];
    const service = serviceWith(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get("include") === "meta") {
        return Response.json({
          error: {
            code: "folders_list_failed",
            message: "Materials folders list failed.",
          },
        }, { status: 502 });
      }
      return Response.json({
        items: [{ id: 9, name: "hero.png", type: "IMAGE" }],
        total: 1,
      });
    });

    await expect(service.query({ kind: "search" })).resolves.toMatchObject({
      total: 1,
      items: [{ assetId: "material:9" }],
    });
    expect(urls.map((url) => url.searchParams.get("include"))).toEqual(["meta", null]);
  });

  it("素材库查询按当前会话隔离并保留库资产身份", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("track")).toBe("library");
      expect(url.searchParams.get("sessionId")).toBe("session-1");
      return Response.json({
        items: [{
          id: 9,
          library_asset_id: "asset-9",
          origin: "aigc",
          name: "hero.png",
          type: "IMAGE",
          file_url: "http://127.0.0.1:4000/uploads/hero.png",
        }],
        total: 1,
      });
    });
    const service = serviceWith(fetch);

    await expect(service.query({
      kind: "library",
      page: 1,
      pageSize: 20,
      materialKind: "image",
    })).resolves.toMatchObject({
      source: "webapp-library",
      total: 1,
      items: [{
        assetId: "library:asset-9",
        meta: {
          materialId: "9",
          libraryAssetId: "asset-9",
          origin: "aigc",
        },
      }],
    });
  });

  it("拖入素材库时携带当前会话并复用应用服务写入口", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        op: "add-to-library",
        ids: [9],
        sessionId: "session-1",
      });
      return Response.json({ ok: true, added: 1 });
    });
    const service = serviceWith(fetch);

    await expect(service.execute({
      kind: "add-to-library",
      ids: ["9"],
    })).resolves.toMatchObject({
      ok: true,
      added: 1,
      refresh: { resource: "enterprise-materials", strategy: "reload" },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createMaterialsLibraryHandler,
  isTrustedMaterialsApiUrl,
  materialsLibraryHandler,
  materialsApiUrl,
  projectMaterial,
  type MaterialsLibraryDependencies,
} from "./materials-library.js";
import type { MaterialsApplicationService } from "../application/index.js";

describe("materials library route", () => {
it("动态桌面凭据仅发往本地默认或显式受信 origin", () => {
  expect(
    isTrustedMaterialsApiUrl("http://127.0.0.1:4000/api/agent/materials"),
  ).toBe(true);
  expect(isTrustedMaterialsApiUrl("https://evil.example/materials")).toBe(false);
  expect(
    isTrustedMaterialsApiUrl("https://webapp.example/api/agent/materials", {
      PI_LABS_WEBAPP_TRUSTED_ORIGINS: "https://webapp.example",
    }),
  ).toBe(true);
});

it("webapp base URL 仅决定 origin，BFF 路径固定", () => {
  expect(
    materialsApiUrl({ PI_LABS_WEBAPP_URL: "https://webapp.example/base/" }).href,
  ).toBe("https://webapp.example/api/agent/materials");
  expect(() =>
    materialsApiUrl({ PI_LABS_WEBAPP_URL: "file:///tmp/webapp" })
  ).toThrow(/HTTP\(S\)/);
});

it("素材行投影为轻量素材引用", () => {
  expect(
    projectMaterial({
      id: 9,
      name: "hero.png",
      type: "IMAGE",
      file_url: "https://cdn.example/hero.png",
      created_at: "2026-07-28T00:00:00Z",
    }),
  ).toEqual({
      assetId: "material:9",
      displayUrl: "https://cdn.example/hero.png",
      createdAt: "2026-07-28T00:00:00Z",
      meta: {
        materialId: "9",
        name: "hero.png",
        type: "IMAGE",
        fileUrl: "https://cdn.example/hero.png",
      },
    });
});

it("未登录明确提示登录后重试", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json(
      {
        error: {
          code: "unauthorized",
          message: "Host authorization rejected.",
        },
      },
      { status: 401 },
    );
    const result = await materialsLibraryHandler({
      method: "GET",
      query: {},
    } as Parameters<typeof materialsLibraryHandler>[0]) as {
      error?: string;
      message?: string;
    };
    expect(result.error).toBe("unauthorized");
    expect(result.message).toBe("请先登录，登录后重试加载素材库。");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

it("桌面登录凭据接入本地素材库", async () => {
  vi.stubEnv("PI_WEB_DESKTOP_CREDENTIAL", "local-session");
  vi.stubEnv("PI_LABS_WEBAPP_AUTHORIZATION", "");
  vi.stubEnv("PI_LABS_MCP_AUTHORIZATION", "");
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization"))
      .toBe("Bearer local-session");
    const url = new URL(
      _input instanceof Request ? _input.url : String(_input),
    );
    expect(url.searchParams.get("folderId")).toBe("12");
    expect(url.searchParams.get("includeSub")).toBe("true");
    return Response.json({
      items: [{
        id: 9,
        name: "hero.png",
        type: "IMAGE",
        file_url: "http://127.0.0.1:4000/uploads/hero.png",
        created_at: "2026-07-28T00:00:00Z",
      }],
      total: 1,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    await expect(materialsLibraryHandler({
      name: "materials-library",
      method: "GET",
      query: {
        kind: "image",
        folderId: "12",
        includeSub: "true",
        page: "2",
        pageSize: "40",
      },
    } as Parameters<typeof materialsLibraryHandler>[0])).resolves.toMatchObject({
      source: "webapp",
      total: 1,
      items: [{
        assetId: "material:9",
        displayUrl: "http://127.0.0.1:4000/uploads/hero.png",
      }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining(
          "http://127.0.0.1:4000/api/agent/materials?page=2&pageSize=40",
        ),
      }),
      expect.any(Object),
    );
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("不把公开素材页地址误作当前登录 Webapp BFF", () => {
  const env = {
    NEXT_PUBLIC_WEBAPP_MATERIALS_URL: "https://blksails.cn/materials/images",
  };
  expect(materialsApiUrl(env).href)
    .toBe("http://127.0.0.1:4000/api/agent/materials");
  expect(isTrustedMaterialsApiUrl("https://blksails.cn/api/agent/materials", env))
    .toBe(false);
});

it("旧 Pane 写协议仅在 Route 边界转为类型化命令", async () => {
  const execute = vi.fn<MaterialsApplicationService["execute"]>(async () => ({
    changedIds: ["9"],
    requestId: "req-route",
    refresh: {
      resource: "enterprise-materials",
      strategy: "reload",
      revision: 1,
    },
  }));
  const service: MaterialsApplicationService = {
    query: vi.fn(async () => ({ items: [] })),
    execute,
  };
  const handler = createMaterialsLibraryHandler({ service });
  await expect(handler({
    name: "materials-library",
    method: "POST",
    query: {},
    body: {
      op: "delete",
      ids: ["9"],
      confirmed: true,
      idempotencyKey: "delete-9",
    },
  })).resolves.toMatchObject({
    requestId: "req-route",
    refresh: { revision: 1 },
  });
  expect(execute).toHaveBeenCalledWith({
    kind: "delete-materials",
    ids: ["9"],
    confirmed: true,
    idempotencyKey: "delete-9",
  });
});

it("会话附件经服务端转存至本地素材目录并返回权威素材行", async () => {
  const service: MaterialsApplicationService = {
    query: vi.fn(async () => ({ items: [] })),
    execute: vi.fn<MaterialsApplicationService["execute"]>(async () => ({
      requestId: "unused",
      refresh: {
        resource: "enterprise-materials",
        strategy: "reload",
        revision: 1,
      },
    })),
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("http://127.0.0.1:4000/api/materials/upload");
    expect(new Headers(init?.headers).get("authorization"))
      .toBe("Bearer local-session");
    const body = init?.body as FormData;
    expect(body.get("material_type")).toBe("IMAGE");
    expect(body.get("folder_id")).toBe("12");
    expect((body.get("files") as File).name).toBe("hero.png");
    return Response.json({
      results: [{
        row: {
          id: 17,
          name: "hero.png",
          type: "IMAGE",
          file_url: "http://127.0.0.1:4000/uploads/hero.png",
        },
      }],
    });
  });
  const getMeta = vi.fn(async () => ({ source: "session-library" }));
  const setMeta = vi.fn(async () => undefined);
  const handler = createMaterialsLibraryHandler({
    service,
    fetch,
    env: {
      PI_LABS_WEBAPP_URL: "http://127.0.0.1:4000",
      PI_WEB_DESKTOP_CREDENTIAL: "local-session",
    },
    getAttachments: () => ({
      available: true,
      resolve: async () => ({
        meta: {
          id: "att-1",
          name: "hero.png",
          mimeType: "image/png",
          size: 3,
          origin: "upload",
          sessionId: "session-1",
          createdAt: "2026-07-29T00:00:00.000Z",
        },
        bytes: async () => new Uint8Array([1, 2, 3]),
        localPath: async () => "",
        url: async () => "",
      }),
      putOutput: async () => {
        throw new Error("unused");
      },
      publish: async () => {
        throw new Error("unused");
      },
      listBySession: async () => [],
      getMeta,
      setMeta,
    }),
  });

  await expect(handler({
    name: "materials-library",
    method: "POST",
    query: {},
    body: {
      op: "upload-to-directory",
      attachmentIds: ["att-1"],
      folderId: "12",
    },
  })).resolves.toMatchObject({
    ok: true,
    items: [{
      assetId: "material:17",
      meta: { materialId: "17", name: "hero.png" },
    }],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(setMeta).toHaveBeenCalledWith("att-1", {
    source: "session-library",
    materialId: "17",
  });
});

it("素材库删除仅隐藏当前会话素材并保留其历史附件", async () => {
  const getMeta = vi.fn(async () => ({ derivedFrom: "att-source" }));
  const setMeta = vi.fn(async () => undefined);
  const getAttachments = (() => ({
    available: true,
    resolve: vi.fn(),
    putOutput: vi.fn(),
    publish: vi.fn(),
    listBySession: async () => [{ id: "att-1" }],
    getMeta,
    setMeta,
  })) as unknown as NonNullable<MaterialsLibraryDependencies["getAttachments"]>;
  const handler = createMaterialsLibraryHandler({
    getAttachments,
  });

  await expect(handler({
    name: "materials-library",
    method: "POST",
    query: {},
    body: {
      op: "remove-from-session-library",
      attachmentIds: ["att-1", "att-other-session"],
    },
  })).resolves.toEqual({ ok: true, attachmentIds: ["att-1"] });
  expect(setMeta).toHaveBeenCalledWith("att-1", {
    derivedFrom: "att-source",
    materialsLibraryHidden: true,
  });
  expect(setMeta).toHaveBeenCalledTimes(1);
});

it("目录已给文件地址时直接转存，不再调用生产 get 接口", async () => {
  const query = vi.fn<MaterialsApplicationService["query"]>(async () => {
    throw new Error("Materials get failed.");
  });
  const putOutput = vi.fn(async () => ({ attachmentId: "att-imported" }));
  const getMeta = vi.fn(async () => ({ source: "materials-directory" }));
  const setMeta = vi.fn(async () => undefined);
  const getAttachments = (() => ({
    available: true,
    putOutput,
    getMeta,
    setMeta,
  })) as unknown as NonNullable<MaterialsLibraryDependencies["getAttachments"]>;
  const handler = createMaterialsLibraryHandler({
    service: {
      query,
      execute: vi.fn(),
    },
    getAttachments,
    fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    })),
    env: { PI_LABS_WEBAPP_URL: "https://blksails.cn" },
  });

  await expect(handler({
    name: "materials-library",
    method: "POST",
    query: {},
    body: {
      op: "import-to-canvas",
      ids: ["9"],
      sources: [{
        id: "9",
        url: "https://blksails.cn/uploads/hero.png",
        name: "hero.png",
        type: "IMAGE",
      }],
    },
  })).resolves.toEqual({ ok: true, attachmentIds: ["att-imported"] });
  expect(query).not.toHaveBeenCalled();
  expect(putOutput).toHaveBeenCalledWith(expect.objectContaining({
    name: "hero.png",
    mimeType: "image/png",
  }));
  expect(setMeta).toHaveBeenCalledWith("att-imported", {
    source: "materials-directory",
    materialId: "9",
  });
});
});

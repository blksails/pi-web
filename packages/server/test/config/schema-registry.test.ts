import { describe, it, expect, vi } from "vitest";
import {
  createSchemaRegistry,
  createSchemaFetcher,
  type SchemaRegistrySnapshot,
} from "../../src/config/schema-registry.js";

const OBJ_SCHEMA = { type: "object", properties: { a: { type: "string" } } };

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("createSchemaFetcher(白名单)", () => {
  it("放行白名单 host 并返回对象", async () => {
    const f = createSchemaFetcher({ allowHosts: ["raw.githubusercontent.com"], fetchImpl: okFetch(OBJ_SCHEMA) });
    expect(await f("https://raw.githubusercontent.com/o/r/main/schema.json")).toEqual(OBJ_SCHEMA);
  });
  it("拒绝非白名单 host", async () => {
    const impl = okFetch(OBJ_SCHEMA);
    const f = createSchemaFetcher({ allowHosts: ["raw.githubusercontent.com"], fetchImpl: impl });
    expect(await f("https://evil.example.com/schema.json")).toBeUndefined();
    expect(impl).not.toHaveBeenCalled(); // 越权前置拦截,不发请求
  });
  it("拒绝非 https", async () => {
    const f = createSchemaFetcher({ allowHosts: ["localhost"], fetchImpl: okFetch(OBJ_SCHEMA) });
    expect(await f("http://localhost/schema.json")).toBeUndefined();
  });
  it("按 URL 缓存,不重复请求", async () => {
    const impl = okFetch(OBJ_SCHEMA);
    const f = createSchemaFetcher({ allowHosts: ["pi.dev"], fetchImpl: impl });
    const url = "https://pi.dev/s.json";
    await f(url);
    await f(url);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe("createSchemaRegistry", () => {
  const snapshot: SchemaRegistrySnapshot = {
    inline: { file: "a.json", schema: OBJ_SCHEMA },
    remote: { file: "b.json", schema: "https://raw.githubusercontent.com/o/r/main/b.json" },
  };

  it("内联 schema 直接命中(离线可用)", async () => {
    const reg = createSchemaRegistry({ snapshot, fetchImpl: okFetch({ never: true }) });
    expect(await reg.lookup("inline")).toEqual({ file: "a.json", schema: OBJ_SCHEMA });
  });

  it("URL schema 经白名单拉取", async () => {
    const reg = createSchemaRegistry({
      snapshot,
      allowHosts: ["raw.githubusercontent.com"],
      fetchImpl: okFetch(OBJ_SCHEMA),
    });
    expect(await reg.lookup("remote")).toEqual({ file: "b.json", schema: OBJ_SCHEMA });
  });

  it("未命中返回 undefined", async () => {
    const reg = createSchemaRegistry({ snapshot, fetchImpl: okFetch(OBJ_SCHEMA) });
    expect(await reg.lookup("nope")).toBeUndefined();
  });

  it("远端 registry 覆盖快照", async () => {
    const remoteRegistry = { extra: { file: "c.json", schema: OBJ_SCHEMA } };
    const reg = createSchemaRegistry({
      snapshot,
      remoteUrl: "https://pi.dev/registry.json",
      allowHosts: ["pi.dev"],
      fetchImpl: okFetch(remoteRegistry),
    });
    expect(await reg.lookup("extra")).toEqual({ file: "c.json", schema: OBJ_SCHEMA });
    // 快照原有条目仍在
    expect(await reg.lookup("inline")).toEqual({ file: "a.json", schema: OBJ_SCHEMA });
  });

  it("远端不可用 → 回退快照", async () => {
    const failFetch = vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const reg = createSchemaRegistry({
      snapshot,
      remoteUrl: "https://pi.dev/registry.json",
      allowHosts: ["pi.dev"],
      fetchImpl: failFetch,
    });
    expect(await reg.lookup("inline")).toEqual({ file: "a.json", schema: OBJ_SCHEMA });
  });

  it("内置快照含 pi-mcp-adapter 内联 schema(离线)", async () => {
    const reg = createSchemaRegistry({ fetchImpl: okFetch({ never: true }) });
    const r = await reg.lookup("pi-mcp-adapter");
    expect(r?.file).toBe("mcp.json");
    expect(r?.schema).toMatchObject({ type: "object" });
  });
});

/**
 * catalog-provider — agent 附件目录补全 provider 单测(spec agent-attachment-catalog,
 * 任务 4.1;Req 2.1, 2.2, 2.4, 3.2, 5.4)。
 */
import { describe, expect, it } from "vitest";
import { createCatalogProvider } from "../../src/completion/providers/catalog-provider.js";
import { createCompletionRegistry } from "../../src/completion/registry.js";
import type { CompletionCtx, CompletionProvider } from "../../src/completion/types.js";
import type { Attachment, AttachmentCatalogResultFrame } from "@blksails/pi-web-protocol";

const CTX: CompletionCtx = { sessionId: "s1", cwd: "/tmp", userId: "u1" };
const OTHER_CTX: CompletionCtx = { sessionId: "s2", cwd: "/tmp", userId: "u1" };

const ATTACHMENT_FIXTURE: Attachment = {
  id: "att_materialized",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 10,
  origin: "tool-output",
  sessionId: "s1",
  createdAt: new Date().toISOString(),
};

interface CatalogSourceLike {
  attachmentCatalogAvailable: boolean;
  requestCatalog(
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string },
    timeoutMs?: number,
  ): Promise<AttachmentCatalogResultFrame>;
}

function makeSession(over: Partial<CatalogSourceLike> = {}): CatalogSourceLike {
  return {
    attachmentCatalogAvailable: true,
    requestCatalog: async () => ({
      type: "piweb_attachment_catalog_result",
      id: "req",
      ok: true,
      entries: [],
    }),
    ...over,
  };
}

describe("createCatalogProvider — 声明门控(Req 2.1/1.2)", () => {
  it("声明未缓存(attachmentCatalogAvailable:false)→ 零往返直接空数组", async () => {
    let called = false;
    const session = makeSession({
      attachmentCatalogAvailable: false,
      requestCatalog: async () => {
        called = true;
        throw new Error("must not be called");
      },
    });
    const provider = createCatalogProvider(
      (id) => (id === "s1" ? session : undefined),
      { head: async () => undefined },
    );
    const items = await provider.complete({ query: "", ctx: CTX });
    expect(items).toEqual([]);
    expect(called).toBe(false);
  });

  it("未知会话 → 空数组", async () => {
    const provider = createCatalogProvider(() => undefined, { head: async () => undefined });
    const items = await provider.complete({ query: "", ctx: CTX });
    expect(items).toEqual([]);
  });
});

describe("createCatalogProvider — list 候选形状(Req 2.1/2.2)", () => {
  it("list 成功 → 候选形状(insertText token/kind/label/detail)", async () => {
    const session = makeSession({
      requestCatalog: async (req) => {
        expect(req).toEqual({ op: "list", query: "rep" });
        return {
          type: "piweb_attachment_catalog_result",
          id: "req",
          ok: true,
          entries: [
            { id: "entry-1", name: "Report", description: "monthly report" },
            { id: "entry-2", name: "Chart", mimeType: "image/png" },
          ],
        };
      },
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    const items = await provider.complete({ query: "rep", ctx: CTX });
    expect(items).toEqual([
      {
        providerId: "attachment-catalog",
        kind: "catalog",
        id: "entry-1",
        label: "Report",
        insertText: "@catalog:entry-1",
        detail: "monthly report",
      },
      {
        providerId: "attachment-catalog",
        kind: "catalog",
        id: "entry-2",
        label: "Chart",
        insertText: "@catalog:entry-2",
        detail: "image/png",
      },
    ]);
  });

  it("ok:false → 空数组", async () => {
    const session = makeSession({
      requestCatalog: async () => ({
        type: "piweb_attachment_catalog_result",
        id: "req",
        ok: false,
        error: { code: "CATALOG_ERROR", message: "boom" },
      }),
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    expect(await provider.complete({ query: "", ctx: CTX })).toEqual([]);
  });

  it("会话隔离:list 仅经请求会话的 requestCatalog 索取", async () => {
    let seenCtxSession: string | undefined;
    const session = makeSession({
      requestCatalog: async () => {
        seenCtxSession = "s1";
        return { type: "piweb_attachment_catalog_result", id: "req", ok: true, entries: [] };
      },
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    await provider.complete({ query: "", ctx: OTHER_CTX }); // 会话 s2 未注册 → getSession 返回 undefined
    expect(seenCtxSession).toBeUndefined();
    await provider.complete({ query: "", ctx: CTX });
    expect(seenCtxSession).toBe("s1");
  });
});

describe("createCatalogProvider — 超时/错误降级不影响其他 provider(Req 2.4)", () => {
  it("requestCatalog 抛错(超时兜底)→ 空组,不冒错", async () => {
    const session = makeSession({
      requestCatalog: async () => {
        throw new Error("timed out");
      },
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    await expect(provider.complete({ query: "", ctx: CTX })).resolves.toEqual([]);
  });

  it("注册表级:catalog provider 慢/抛错超时降级,不阻塞其余 provider", async () => {
    const reg = createCompletionRegistry({ providerTimeoutMs: 50 });
    const session = makeSession({
      requestCatalog: () => new Promise(() => {}), // 永不 resolve
    });
    const catalogProvider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    reg.register(catalogProvider);
    const fastProvider: CompletionProvider = {
      id: "fast",
      trigger: "@",
      kind: "fast",
      async complete() {
        return [
          {
            providerId: "fast",
            kind: "fast",
            id: "ok",
            label: "ok",
          },
        ];
      },
    };
    reg.register(fastProvider);
    const res = await reg.query("@", "x", CTX);
    expect(res.items.map((i) => i.kind)).toEqual(["fast"]);
  });
});

describe("createCatalogProvider — resolve 兜底物化(Req 3.2/3.4)", () => {
  it("materialize 成功 → 标准 attachment 标记文本", async () => {
    const session = makeSession({
      requestCatalog: async (req) => {
        expect(req).toEqual({ op: "materialize", entryId: "entry-1" });
        return {
          type: "piweb_attachment_catalog_result",
          id: "req",
          ok: true,
          attachmentId: "att_materialized",
        };
      },
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async (id) => (id === "att_materialized" ? ATTACHMENT_FIXTURE : undefined),
    });
    const resolved = await provider.resolve!(
      { kind: "catalog", id: "entry-1", raw: "@catalog:entry-1" },
      CTX,
    );
    expect(resolved).toEqual({
      text: "[attachment id=att_materialized type=application/pdf name=report.pdf]",
    });
  });

  it("materialize 失败(ok:false)→ null(框架保留原文)", async () => {
    const session = makeSession({
      requestCatalog: async () => ({
        type: "piweb_attachment_catalog_result",
        id: "req",
        ok: false,
        error: { code: "ENTRY_NOT_FOUND", message: "gone" },
      }),
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    const resolved = await provider.resolve!(
      { kind: "catalog", id: "entry-1", raw: "@catalog:entry-1" },
      CTX,
    );
    expect(resolved).toBeNull();
  });

  it("materialize 抛错(超时)→ null", async () => {
    const session = makeSession({
      requestCatalog: async () => {
        throw new Error("timed out");
      },
    });
    const provider = createCatalogProvider((id) => (id === "s1" ? session : undefined), {
      head: async () => undefined,
    });
    const resolved = await provider.resolve!(
      { kind: "catalog", id: "entry-1", raw: "@catalog:entry-1" },
      CTX,
    );
    expect(resolved).toBeNull();
  });

  it("未知会话 → null", async () => {
    const provider = createCatalogProvider(() => undefined, { head: async () => undefined });
    const resolved = await provider.resolve!(
      { kind: "catalog", id: "entry-1", raw: "@catalog:entry-1" },
      CTX,
    );
    expect(resolved).toBeNull();
  });
});

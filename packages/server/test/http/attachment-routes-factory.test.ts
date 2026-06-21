/**
 * 集成:createAttachmentRoutes(store) 注入路由工厂(attachment-store task 3.3)。
 *
 * 覆盖(Req 1.8/7.1;design.md §attachment-routes、§Modified Files barrel 导出):
 *  - 工厂返回上传 + 分发两条注入路由,可直接放入 createPiWebHandler({ routes })。
 *  - 上传路由走 `/sessions/:id/attachments`(带会话门控):会话存在 + 带文件 → 200 origin=upload。
 *  - 分发路由走 RAW_ATTACHMENT_ROUTE(`:attachmentId`,不绑会话):有效签名 + 无会话 → 200 字节。
 *  - 受认可的复用面与工厂/配置工厂可从服务包根 barrel `@pi-web/server` 顶层 import(类型层)。
 *
 * 关键(task 3.2 的属性必须保持):分发路由必须用 RAW_ATTACHMENT_ROUTE(非 `:id`),
 * 否则 Router 会把附件 id 当 sessionId 触发会话存在性 404 门控,破坏读路径不绑会话。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  attachmentStoreConfigFromEnv,
  type AttachmentStore,
} from "../../src/attachment/index.js";
import {
  createAttachmentRoutes,
  RAW_ATTACHMENT_ROUTE,
} from "../../src/http/routes/attachment-routes.js";
import { asPiSession, MockSession } from "./helpers.js";

// 顶层(服务包根 barrel)import 面:类型层 import 编译通过即证导出存在。
import {
  createAttachmentRoutes as createAttachmentRoutesFromBarrel,
  attachmentStoreConfigFromEnv as attachmentStoreConfigFromEnvBarrel,
  type AttachmentStore as AttachmentStoreFromBarrel,
  type PutInput as PutInputFromBarrel,
  type BlobStore as BlobStoreFromBarrel,
  type BlobMeta as BlobMetaFromBarrel,
  AttachmentRegistry as AttachmentRegistryFromBarrel,
  LocalFsBlobBackend as LocalFsBlobBackendFromBarrel,
  type UrlSigner as UrlSignerFromBarrel,
} from "../../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `attach-factory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeStore(): AttachmentStore {
  return attachmentStoreConfigFromEnv({
    PI_WEB_ATTACHMENT_DIR: tmpDir,
    PI_WEB_ATTACHMENT_SECRET: "test-secret-stable",
  }).store;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function readBytes(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

/** 经工厂返回的路由装配完整 handler(可选预置会话以满足上传门控)。 */
function makeAssembled(attachStore: AttachmentStore, sessionId?: string) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  if (sessionId !== undefined) {
    store.create(asPiSession(new MockSession(sessionId)));
  }
  return createPiWebHandler({
    manager,
    store,
    routes: [...createAttachmentRoutes(attachStore)],
    authResolver: () => ({ anonymous: true }),
  });
}

describe("createAttachmentRoutes (factory shape)", () => {
  it("返回上传 + 分发两条注入路由,路径/方法与契约一致", () => {
    const routes = createAttachmentRoutes(makeStore());
    expect(routes).toHaveLength(2);

    const upload = routes.find((r) => r.method === "POST");
    const raw = routes.find((r) => r.method === "GET");
    expect(upload?.path).toBe("/sessions/:id/attachments");
    // 关键:分发路由用 RAW_ATTACHMENT_ROUTE(:attachmentId),保持不绑会话门控。
    expect(raw?.path).toBe(RAW_ATTACHMENT_ROUTE);
    expect(typeof upload?.handler).toBe("function");
    expect(typeof raw?.handler).toBe("function");
  });
});

describe("createAttachmentRoutes (full assembly)", () => {
  it("上传(带会话)→ 200 origin=upload + 可经分发 URL 取回字节(无会话)", async () => {
    const attachStore = makeStore();
    const handler = makeAssembled(attachStore, "sess-1");

    // 上传:走 /sessions/:id/attachments 会话门控。
    const fd = new FormData();
    const payload = "factory roundtrip bytes";
    fd.append(
      "file",
      new Blob([new TextEncoder().encode(payload)], { type: "image/png" }),
      "pic.png",
    );
    const upRes = await handler(
      new Request("http://x/sessions/sess-1/attachments", { method: "POST", body: fd }),
    );
    expect(upRes.status).toBe(200);
    const body = await readJson(upRes);
    const attachment = body["attachment"] as Record<string, unknown>;
    expect(attachment["origin"]).toBe("upload");
    expect(attachment["sessionId"]).toBe("sess-1");
    const displayUrl = String(body["displayUrl"]);
    expect(displayUrl).toContain("/attachments/");

    // 分发:走 RAW_ATTACHMENT_ROUTE,不绑会话,靠签名自洽鉴权。
    const rawRes = await handler(new Request(`http://x${displayUrl}`, { method: "GET" }));
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("Content-Type")).toBe("image/png");
    expect((await readBytes(rawRes)).toString("utf8")).toBe(payload);
  });

  it("分发路由不绑会话:有效签名 + 无任何 session → 200(防 :id 会话门控)", async () => {
    const attachStore = makeStore();
    // 不预置任何 session。
    const handler = makeAssembled(attachStore);

    const bytes = new TextEncoder().encode("no-session ok");
    const att = await attachStore.put({
      bytes,
      name: "f.bin",
      mimeType: "text/plain",
      size: bytes.byteLength,
      sessionId: "sess-x",
      origin: "upload",
    });
    const displayUrl = await attachStore.presignUrl(att.id);

    const rawRes = await handler(new Request(`http://x${displayUrl}`, { method: "GET" }));
    // 若分发路由误用 `:id`,Router 会因会话不存在返回 404 —— 此处必须 200。
    expect(rawRes.status).toBe(200);
    expect((await readBytes(rawRes)).toString("utf8")).toBe("no-session ok");
  });
});

describe("@pi-web/server 根 barrel 复用面导出", () => {
  it("工厂 / 配置工厂 / 复用面类型与类可从顶层 import", () => {
    // 值导出:工厂、配置工厂、可 new 的复用面类。
    expect(typeof createAttachmentRoutesFromBarrel).toBe("function");
    expect(typeof attachmentStoreConfigFromEnvBarrel).toBe("function");
    expect(typeof AttachmentRegistryFromBarrel).toBe("function");
    expect(typeof LocalFsBlobBackendFromBarrel).toBe("function");

    // 类型层引用(编译期即证导出存在;运行期为占位断言)。
    const _typeProbe: {
      store?: AttachmentStoreFromBarrel;
      put?: PutInputFromBarrel;
      blob?: BlobStoreFromBarrel;
      meta?: BlobMetaFromBarrel;
      signer?: UrlSignerFromBarrel;
    } = {};
    expect(_typeProbe).toBeTypeOf("object");
  });
});

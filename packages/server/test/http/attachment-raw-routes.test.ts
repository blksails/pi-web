/**
 * 集成:GET /attachments/:id/raw 分发端点 handler(attachment-store task 3.2)。
 *
 * 覆盖(Req 4.1/4.2/4.3/4.4):
 *  - 有效签名 → 200 + 正确 Content-Type(附件 mime)+ Cache-Control + 原始字节。
 *  - 无签名 / 篡改签名 / 过期签名 → 401(不返回字节)。
 *  - 签名有效但 id 不存在 → 404,且与签名失败响应**语义不可区分**(防枚举:
 *    未授权/未找到响应不因 id 是否存在而泄露存在性差异)。
 *
 * 读路径**不**绑会话:分发 handler 靠签名自洽鉴权,不复用 `:id` 会话门控
 * (注入路由用非 `id` 参数名,避免 Router 把附件 id 当作 sessionId 做会话存在性 404)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import type { AuthContext } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  attachmentStoreConfigFromEnv,
  type AttachmentStore,
} from "../../src/attachment/index.js";
import {
  makeRawAttachmentHandler,
  RAW_ATTACHMENT_ROUTE,
} from "../../src/http/routes/attachment-routes.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `attach-raw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

/** 落库一个附件并返回其描述符 + 即时签名分发 URL(presignUrl)。 */
async function seed(
  store: AttachmentStore,
  body: string,
  mimeType: string,
): Promise<{ id: string; displayUrl: string }> {
  const bytes = new TextEncoder().encode(body);
  const att = await store.put({
    bytes,
    name: "f.bin",
    mimeType,
    size: bytes.byteLength,
    sessionId: "sess-1",
    origin: "upload",
  });
  const displayUrl = await store.presignUrl(att.id);
  return { id: att.id, displayUrl };
}

/** 从 presignUrl(相对路径 `/attachments/:id/raw?exp&sig`)构造绝对 Request URL。 */
function rawRequest(displayUrl: string): Request {
  return new Request(`http://x${displayUrl}`, { method: "GET" });
}

async function readBytes(res: Response): Promise<Buffer> {
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ─── 直接调用 handler(隔离) ──────────────────────────────────────────────

describe("makeRawAttachmentHandler (isolated)", () => {
  it("有效签名 → 200 + 正确 Content-Type + Cache-Control + 字节", async () => {
    const store = makeStore();
    const { displayUrl } = await seed(store, "raw bytes here", "image/png");
    const handler = makeRawAttachmentHandler(store);

    const req = rawRequest(displayUrl);
    const res = await handler({
      req,
      auth: { anonymous: true } as AuthContext,
      url: new URL(req.url),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBeTruthy();
    expect((await readBytes(res)).toString("utf8")).toBe("raw bytes here");
  });

  it("无签名(缺 exp/sig)→ 401,不返回字节", async () => {
    const store = makeStore();
    const { id } = await seed(store, "secret", "text/plain");
    const handler = makeRawAttachmentHandler(store);

    const req = new Request(`http://x/attachments/${id}/raw`, { method: "GET" });
    const res = await handler({
      req,
      auth: { anonymous: true } as AuthContext,
      url: new URL(req.url),
    });

    expect(res.status).toBe(401);
    expect((await readBytes(res)).toString("utf8")).not.toContain("secret");
  });

  it("篡改签名 → 401", async () => {
    const store = makeStore();
    const { displayUrl } = await seed(store, "secret", "text/plain");
    const handler = makeRawAttachmentHandler(store);

    const tampered = displayUrl.replace(/sig=[^&]+/, "sig=deadbeef");
    const req = rawRequest(tampered);
    const res = await handler({
      req,
      auth: { anonymous: true } as AuthContext,
      url: new URL(req.url),
    });

    expect(res.status).toBe(401);
  });

  it("过期签名 → 401", async () => {
    const store = makeStore();
    const { id } = await seed(store, "secret", "text/plain");
    const handler = makeRawAttachmentHandler(store);

    // 签发一个立刻过期的 URL(负 TTL → exp 已是过去时刻)。
    const expired = await store.presignUrl(id, { expiresInMs: -1000 });
    const req = rawRequest(expired);
    const res = await handler({
      req,
      auth: { anonymous: true } as AuthContext,
      url: new URL(req.url),
    });

    expect(res.status).toBe(401);
  });

  it("签名有效但 id 不存在 → 404", async () => {
    const store = makeStore();
    const handler = makeRawAttachmentHandler(store);

    // 为一个从未落库的 id 签发**有效**签名(signer 只签 id|exp,不查存在性)。
    const ghostUrl = await store.presignUrl("att_does_not_exist");
    const req = rawRequest(ghostUrl);
    const res = await handler({
      req,
      auth: { anonymous: true } as AuthContext,
      url: new URL(req.url),
    });

    expect(res.status).toBe(404);
  });

  it("防枚举:无效签名(存在 id)与无效签名(不存在 id)响应不可区分", async () => {
    const store = makeStore();
    const { id } = await seed(store, "secret", "text/plain");
    const handler = makeRawAttachmentHandler(store);

    // 同一种「篡改签名」攻击,分别打到存在/不存在的 id。
    const badExp = Date.now() + 60_000;
    const reqExisting = new Request(
      `http://x/attachments/${id}/raw?exp=${badExp}&sig=deadbeef`,
      { method: "GET" },
    );
    const reqGhost = new Request(
      `http://x/attachments/att_ghost_xyz/raw?exp=${badExp}&sig=deadbeef`,
      { method: "GET" },
    );

    const resExisting = await handler({
      req: reqExisting,
      auth: { anonymous: true } as AuthContext,
      url: new URL(reqExisting.url),
    });
    const resGhost = await handler({
      req: reqGhost,
      auth: { anonymous: true } as AuthContext,
      url: new URL(reqGhost.url),
    });

    // 防枚举:签名无效一律 401(先校验签名,签名无效不查存在性);
    // 两者状态码与错误体一致,攻击者无法据响应区分该 id 是否存在。
    expect(resExisting.status).toBe(401);
    expect(resGhost.status).toBe(401);
    expect(await resExisting.text()).toBe(await resGhost.text());
  });

  it("防枚举:有效签名下,存在与不存在 id 的响应均不泄露另一附件存在性", async () => {
    const store = makeStore();
    const { displayUrl } = await seed(store, "real", "text/plain");
    const handler = makeRawAttachmentHandler(store);

    const ghostUrl = await store.presignUrl("att_ghost_xyz");
    const reqGhost = rawRequest(ghostUrl);
    const resGhost = await handler({
      req: reqGhost,
      auth: { anonymous: true } as AuthContext,
      url: new URL(reqGhost.url),
    });
    // 不存在 → 404(签名有效才会走到存在性查询)。
    expect(resGhost.status).toBe(404);

    const reqReal = rawRequest(displayUrl);
    const resReal = await handler({
      req: reqReal,
      auth: { anonymous: true } as AuthContext,
      url: new URL(reqReal.url),
    });
    expect(resReal.status).toBe(200);
  });
});

// ─── 完整 handler 装配(读路径不绑会话:无 session 也能取) ────────────────

describe("GET /attachments/:id/raw (full assembly, no session gating)", () => {
  function makeAssembledHandler(attachStore: AttachmentStore) {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    // 注意:不创建任何 session —— 分发端点靠签名自洽鉴权,不依赖会话存在。
    return createPiWebHandler({
      manager,
      store,
      routes: [
        {
          method: "GET",
          path: RAW_ATTACHMENT_ROUTE,
          handler: makeRawAttachmentHandler(attachStore),
        },
      ],
      authResolver: () => ({ anonymous: true }),
    });
  }

  it("有效签名 + 无会话 → 200 字节(读路径不绑会话)", async () => {
    const attachStore = makeStore();
    const { displayUrl } = await seed(attachStore, "via router", "text/plain");
    const handler = makeAssembledHandler(attachStore);

    const res = await handler(rawRequest(displayUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect((await readBytes(res)).toString("utf8")).toBe("via router");
  });

  it("有效签名 + id 不存在 → 404(经完整装配)", async () => {
    const attachStore = makeStore();
    const handler = makeAssembledHandler(attachStore);

    const ghostUrl = await attachStore.presignUrl("att_missing");
    const res = await handler(rawRequest(ghostUrl));
    expect(res.status).toBe(404);
  });

  it("无效签名 → 401(经完整装配)", async () => {
    const attachStore = makeStore();
    const { id } = await seed(attachStore, "x", "text/plain");
    const handler = makeAssembledHandler(attachStore);

    const res = await handler(
      new Request(`http://x/attachments/${id}/raw?exp=${Date.now() + 60_000}&sig=bad`, {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
  });
});

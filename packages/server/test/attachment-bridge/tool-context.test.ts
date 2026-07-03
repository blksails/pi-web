/**
 * attachment-tool-bridge · tool 接入上下文 `createAttachmentToolContext` 单元测试
 * (task 4.1;Req 4.1, 3.3, 3.4)。
 *
 * 断言(design.md §AttachmentToolContext + 示例 AgentTool):
 * - 可用 store + sessionId → `available === true`;`resolve(id)` 委托
 *   {@link resolveAttachment}(取回携上游元数据的句柄、字节往返一致);
 *   `putOutput(...)` 委托 {@link putToolOutput}(落库铸 `tool-output` 公开 id、返回引用而非字节)(Req 4.1);
 * - 上下文以闭包绑定当前 `sessionId`:`putOutput` 入参不含 `sessionId`,由上下文注入,落库描述符属主一致;
 * - 存储能力不可用(store 为 `undefined`,即 env 缺失降级)→ `available === false`,且
 *   `resolve`/`putOutput` 安全拒绝(抛可 `instanceof` 识别的 {@link AttachmentCapabilityUnavailableError}),
 *   而非以未定义行为崩溃(Req 3.4);
 * - 不回调主进程:全部经子进程内 store 句柄(Req 3.3,本测试以同进程 store 等价证明)。
 *
 * 用临时目录经 `attachmentStoreConfigFromEnv` 构造真实 store;afterEach 清理。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";
import type { AttachmentStore } from "../../src/attachment/attachment-store.js";
import {
  createAttachmentToolContext,
  AttachmentCapabilityUnavailableError,
} from "../../src/attachment-bridge/index.js";

const SECRET = "stable-secret-for-tool-context-test";
const SESSION = "sess-ctx";

let root: string;
let store: AttachmentStore;

const INPUT_BYTES = new Uint8Array([9, 8, 7, 6, 5]);
const OUTPUT_BYTES = new Uint8Array([1, 2, 3, 4]);

async function putUpload() {
  return store.put({
    bytes: INPUT_BYTES,
    name: "in.bin",
    mimeType: "application/octet-stream",
    size: INPUT_BYTES.length,
    sessionId: SESSION,
    origin: "upload",
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attctx-"));
  ({ store } = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: root,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createAttachmentToolContext — 可用 store(Req 4.1)", () => {
  it("available === true", () => {
    const ctx = createAttachmentToolContext(store, SESSION);
    expect(ctx.available).toBe(true);
  });

  it("resolve(id) 委托 resolveAttachment:取回携元数据句柄、字节往返一致", async () => {
    const att = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);

    const handle = await ctx.resolve(att.id);
    expect(handle.meta.id).toBe(att.id);
    expect(handle.meta.sessionId).toBe(SESSION);
    expect([...(await handle.bytes())]).toEqual([...INPUT_BYTES]);
  });

  it("putOutput(...) 委托 putToolOutput:落库铸 tool-output 公开 id、注入 sessionId 属主、返回引用而非字节", async () => {
    const ctx = createAttachmentToolContext(store, SESSION);

    const ref = await ctx.putOutput({
      bytes: OUTPUT_BYTES,
      name: "out.png",
      mimeType: "image/png",
    });

    expect(ref.attachmentId.startsWith("att_")).toBe(true);
    // 引用不内联字节。
    const bag = ref as unknown as Record<string, unknown>;
    expect(bag.bytes).toBeUndefined();
    expect(bag.base64).toBeUndefined();
    expect(bag.data).toBeUndefined();

    // 落库描述符:origin 为 tool-output、sessionId 由上下文注入(属主一致)。
    const head = await store.head(ref.attachmentId);
    expect(head).toBeDefined();
    expect(head!.origin).toBe("tool-output");
    expect(head!.sessionId).toBe(SESSION);
    expect(head!.size).toBe(OUTPUT_BYTES.length);

    // 同一 id 空间:产出 id 可被同一上下文再次 resolve。
    const handle = await ctx.resolve(ref.attachmentId);
    expect([...(await handle.bytes())]).toEqual([...OUTPUT_BYTES]);
  });

  it("listBySession() 枚举当前会话附件(mimeType/id/name,不含字节;领域无关增量 seam)", async () => {
    const att = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);

    const list = await ctx.listBySession();
    const found = list.find((a) => a.id === att.id);
    expect(found).toBeDefined();
    expect(found).toMatchObject({
      id: att.id,
      name: "in.bin",
      mimeType: "application/octet-stream",
      sessionId: SESSION,
    });
    expect(found).not.toHaveProperty("bytes");

    // 不返回其它会话的附件。
    const otherSessionAtt = await store.put({
      bytes: new Uint8Array([1]),
      name: "other.bin",
      mimeType: "application/octet-stream",
      size: 1,
      sessionId: "sess-other",
      origin: "upload",
    });
    const listAgain = await ctx.listBySession();
    expect(listAgain.some((a) => a.id === otherSessionAtt.id)).toBe(false);
  });

  it("getMeta/setMeta 往返(opaque:存任意 JSON 原样取回),不影响 descriptor 其它字段", async () => {
    const att = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);

    await expect(ctx.getMeta(att.id)).resolves.toBeUndefined();

    const meta = { derivedFrom: "att_parent", genParams: { seed: 42 } };
    await ctx.setMeta(att.id, meta);
    await expect(ctx.getMeta(att.id)).resolves.toEqual(meta);

    // descriptor 其它字段原样保留。
    const head = await store.head(att.id);
    expect(head).toMatchObject({
      id: att.id,
      name: "in.bin",
      mimeType: "application/octet-stream",
      sessionId: SESSION,
      origin: "upload",
    });
  });

  it("跨主进程/子进程实例指向同一后端:tool-context 写的 meta 可被另一 store 实例读到", async () => {
    const att = await putUpload();
    const ctx = createAttachmentToolContext(store, SESSION);
    await ctx.setMeta(att.id, { crossProcess: true });

    // 模拟主进程:同 env 另建一个 AttachmentStore 实例(同 root)。
    const { store: mainStore } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: root,
      [ATTACHMENT_SECRET_ENV]: SECRET,
    });
    await expect(mainStore.getMeta(att.id)).resolves.toEqual({
      crossProcess: true,
    });
  });
});

describe("createAttachmentToolContext — 存储能力不可用(env 缺失降级,Req 3.4)", () => {
  it("store 为 undefined → available === false", () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    expect(ctx.available).toBe(false);
  });

  it("不可用 → resolve 安全拒绝(抛可识别 AttachmentCapabilityUnavailableError),不崩溃", async () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    const err = await ctx.resolve("att_whatever").catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentCapabilityUnavailableError);
    expect(err).toBeInstanceOf(Error);
  });

  it("不可用 → putOutput 安全拒绝(抛可识别 AttachmentCapabilityUnavailableError),不崩溃", async () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    const err = await ctx
      .putOutput({
        bytes: OUTPUT_BYTES,
        name: "out.png",
        mimeType: "image/png",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentCapabilityUnavailableError);
    expect(err).toBeInstanceOf(Error);
  });

  it("不可用 → listBySession 安全拒绝(抛可识别 AttachmentCapabilityUnavailableError),不崩溃", async () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    const err = await ctx.listBySession().catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentCapabilityUnavailableError);
  });

  it("不可用 → getMeta/setMeta 安全拒绝(抛可识别 AttachmentCapabilityUnavailableError),不崩溃", async () => {
    const ctx = createAttachmentToolContext(undefined, SESSION);
    const getErr = await ctx.getMeta("att_whatever").catch((e) => e);
    expect(getErr).toBeInstanceOf(AttachmentCapabilityUnavailableError);
    const setErr = await ctx.setMeta("att_whatever", {}).catch((e) => e);
    expect(setErr).toBeInstanceOf(AttachmentCapabilityUnavailableError);
  });
});

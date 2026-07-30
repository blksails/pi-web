/**
 * attachment-tool-bridge · tool-output 落库回流 `putToolOutput` 单元测试
 * (task 3.3;Req 7.1, 7.2, 7.3, 7.4)。
 *
 * 断言(design.md §tool-output / Testing Strategy/Unit 5):
 * - 落库铸 `origin:"tool-output"` 的公开 `att_` id(经上游门面 `put`,先落 blob 后描述符,Req 7.1);
 * - 返回**引用**(`{ attachmentId(att_), displayUrl }`)而非内联字节:返回对象不含 bytes/base64/data
 *   字段;`displayUrl` 与上游 `presignUrl` 同形(`/raw?exp&sig`),展示侧可经既有分发 URL 呈现(Req 7.3);
 * - 落库的描述符经门面 `head(id)` 可证 `origin==='tool-output'` 且 `sessionId` 属主一致(Req 7.1);
 * - 产出 id 与上传 id **同一空间**:产出 id 可被 `resolveAttachment`(task 2.2)再次解析(Req 7.2);
 * - 落库失败(注入门面 `put` 抛错)→ **不返回引用**(向上抛可识别失败),且不暴露半落库引用(Req 7.4)。
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
  putToolOutput,
  resolveAttachment,
  ToolOutputPutError,
} from "../../src/attachment-bridge/index.js";

const SECRET = "stable-secret-for-tool-output-test";

let root: string;
let store: AttachmentStore;

const PAYLOAD = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);

const baseInput = () => ({
  bytes: PAYLOAD,
  name: "out.png",
  mimeType: "image/png",
  sessionId: "sess-out",
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "atttoolout-"));
  ({ store } = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: root,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("putToolOutput — 先落库铸 tool-output 公开 id(Req 7.1)", () => {
  it("落库铸 origin:'tool-output' 的 att_ id;门面 head 证 origin + sessionId 属主", async () => {
    const ref = await putToolOutput(store, baseInput());

    expect(ref.attachmentId.startsWith("att_")).toBe(true);

    // 经门面 head 确认描述符:origin 为 tool-output、sessionId 属主一致。
    const head = await store.head(ref.attachmentId);
    expect(head).toBeDefined();
    expect(head!.origin).toBe("tool-output");
    expect(head!.sessionId).toBe("sess-out");
    expect(head!.name).toBe("out.png");
    expect(head!.mimeType).toBe("image/png");
    expect(head!.size).toBe(PAYLOAD.length);
  });
});

describe("putToolOutput — 返回引用而非内联字节(Req 7.3)", () => {
  it("返回 { attachmentId, displayUrl } 引用,不含 bytes/base64/data 字节字段", async () => {
    const ref = await putToolOutput(store, baseInput());

    // displayUrl 与上游 presignUrl 同形(/raw?exp&sig),展示侧可经既有分发 URL 呈现。
    expect(ref.displayUrl).toContain(ref.attachmentId);
    const params = new URL(ref.displayUrl, "http://x").searchParams;
    expect(params.get("exp")).not.toBeNull();
    expect(params.get("sig")).not.toBeNull();
    // 主进程同 secret 校验通过(同形且可验签)。
    expect(
      store.verifyUrl(
        ref.attachmentId,
        Number(params.get("exp")),
        params.get("sig")!,
      ),
    ).toBe(true);

    // 引用不内联字节:无 bytes/base64/data(任意大小写/嵌套字段名)形态。
    for (const k of Object.keys(ref)) {
      expect(k.toLowerCase()).not.toContain("base64");
      expect(k.toLowerCase()).not.toContain("bytes");
      expect(k.toLowerCase()).not.toContain("data");
    }
    const bag = ref as unknown as Record<string, unknown>;
    expect(bag.bytes).toBeUndefined();
    expect(bag.base64).toBeUndefined();
    expect(bag.data).toBeUndefined();
  });
});

describe("putToolOutput — 同一 id 空间可被再次解析(Req 7.2)", () => {
  it("产出 id 可被 resolveAttachment 再次解析(证与上传 id 同一空间)", async () => {
    const ref = await putToolOutput(store, baseInput());

    // 同一 store(同一 id 空间),resolve 产出 id 得携元数据句柄,字节往返一致。
    const handle = await resolveAttachment(store, ref.attachmentId);
    expect(handle.meta.id).toBe(ref.attachmentId);
    expect(handle.meta.origin).toBe("tool-output");
    expect([...(await handle.bytes())]).toEqual([...PAYLOAD]);
  });
});

describe("putToolOutput — 落库失败不回引用(Req 7.4)", () => {
  it("门面 put 抛错 → 抛 ToolOutputPutError(可识别),不返回引用", async () => {
    const boom = new Error("blob backend exploded");
    const failingStore = {
      put: () => Promise.reject(boom),
    } as unknown as AttachmentStore;

    const err = await putToolOutput(failingStore, baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(ToolOutputPutError);
    expect(err).toBeInstanceOf(Error);
    // 携带原因,便于 tool execute 据此标失败。
    expect((err as ToolOutputPutError).cause).toBe(boom);
  });

  it("落库失败不暴露半落库引用:不向调用方泄漏 attachmentId/displayUrl", async () => {
    const failingStore = {
      put: () => Promise.reject(new Error("save failed")),
    } as unknown as AttachmentStore;

    const result = await putToolOutput(failingStore, baseInput()).then(
      (r) => ({ ok: true as const, r }),
      (e) => ({ ok: false as const, e }),
    );
    expect(result.ok).toBe(false);
    // 失败路径不产出任何引用对象。
    expect((result as { r?: unknown }).r).toBeUndefined();
  });
});

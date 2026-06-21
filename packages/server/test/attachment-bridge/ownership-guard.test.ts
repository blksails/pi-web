/**
 * attachment-tool-bridge · `beforeToolCall` 属主校验闸门 `makeBeforeToolCall`
 * 单元测试(task 3.1;Req 5.1, 5.2, 5.3, 5.4)。
 *
 * 闸门:在 tool `execute` 之前,从工具调用参数(`event.input.attachmentId`)提取附件引用;
 * 用子进程 store `head(id)` 查属主 `sessionId`,与当前会话 `sessionId` 比对:
 * - 他会话拥有 / 不存在 / 属主未知 → `{ block: true, reason }`(5.2/5.3);
 * - 参数无 `attachmentId` → 放行(返回 `undefined`,5.4);
 * - 本会话拥有 → 放行(5.1)。
 *
 * 用临时 store 落几个不同 `sessionId` 的附件构造场景(真实 LocalFs 后端,经门面 put/head)。
 * 临时目录,afterEach 清理;不依赖 process.env(显式注入 env)。
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
import { makeBeforeToolCall } from "../../src/attachment-bridge/index.js";

const SECRET = "stable-secret-for-ownership-guard-test";

let root: string;
let store: AttachmentStore;

/** 为指定会话落一个附件,返回其公开 id(att_<nanoid>)。 */
async function putFor(sessionId: string): Promise<string> {
  const att = await store.put({
    bytes: new Uint8Array([1, 2, 3]),
    name: "in.bin",
    mimeType: "application/octet-stream",
    size: 3,
    sessionId,
    origin: "upload",
  });
  return att.id;
}

/** 构造一个最小可用的 `tool_call` event,携带任意 input 参数。 */
function toolCallEvent(input: Record<string, unknown>) {
  return {
    type: "tool_call" as const,
    toolCallId: "tc-1",
    toolName: "edit_image",
    input,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attguard-"));
  const cfg = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: root,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  });
  store = cfg.store;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("makeBeforeToolCall — 属主校验闸门(Req 5.1-5.4)", () => {
  it("他会话拥有的 attachmentId → block(越权,不进 execute)(Req 5.2)", async () => {
    const otherId = await putFor("sess-other");
    const guard = makeBeforeToolCall(store, "sess-current");

    const result = await guard(toolCallEvent({ attachmentId: otherId }));

    expect(result).toBeDefined();
    expect(result?.block).toBe(true);
    expect(typeof result?.reason).toBe("string");
    expect(result?.reason && result.reason.length > 0).toBe(true);
  });

  it("不存在的 attachmentId → block(不把不存在引用当可解析)(Req 5.3)", async () => {
    const guard = makeBeforeToolCall(store, "sess-current");

    const result = await guard(toolCallEvent({ attachmentId: "att_does_not_exist" }));

    expect(result).toBeDefined();
    expect(result?.block).toBe(true);
  });

  it("参数不含 attachmentId → 放行(不阻断与附件无关的 tool)(Req 5.4)", async () => {
    const guard = makeBeforeToolCall(store, "sess-current");

    const result = await guard(toolCallEvent({ query: "hello", count: 3 }));

    // 放行:不返回 block(undefined 表示不改写、不阻断)。
    expect(result).toBeUndefined();
  });

  it("本会话拥有的 attachmentId → 放行(Req 5.1)", async () => {
    const ownId = await putFor("sess-current");
    const guard = makeBeforeToolCall(store, "sess-current");

    const result = await guard(toolCallEvent({ attachmentId: ownId }));

    expect(result).toBeUndefined();
  });

  it("attachmentId 非字符串(类型不符)→ 视为无引用,放行(Req 5.4)", async () => {
    const guard = makeBeforeToolCall(store, "sess-current");

    const result = await guard(toolCallEvent({ attachmentId: 123 }));

    expect(result).toBeUndefined();
  });

  it("store 不可用(undefined)且含 attachmentId → block(无法校验属主即不可放行)(Req 5.2/5.3)", async () => {
    const guard = makeBeforeToolCall(undefined, "sess-current");

    const result = await guard(toolCallEvent({ attachmentId: "att_anything" }));

    expect(result?.block).toBe(true);
  });

  it("store 不可用(undefined)且无 attachmentId → 放行(与附件无关不受影响)(Req 5.4)", async () => {
    const guard = makeBeforeToolCall(undefined, "sess-current");

    const result = await guard(toolCallEvent({ query: "x" }));

    expect(result).toBeUndefined();
  });
});

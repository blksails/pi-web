/**
 * attachment-tool-bridge · runner 装配接线 `wireAttachmentBridge` 集成测试
 * (task 5.1;Req 2.3, 5.1, 6.3, 3.3)。
 *
 * 证明装配后:
 *  ① 执行前闸门(属主校验)被接到 `agent.beforeToolCall`:他会话 `attachmentId` → `{block:true}`;
 *  ② 结果出口闸门(base64 剥离)被接到 `agent.afterToolCall`:含内联 base64 的 tool result 被剥离为引用;
 *  ③ 示例工具经 globalThis seam(`__piWebAttachmentToolContext__`)拿到 `available:true` 的 ctx,
 *     能 `resolve`/`putOutput`(子进程 store 句柄透给 customTools);
 *  ④ 会话生命周期结束触发 `cleanupForSession`(会话级临时文件回收)。
 *
 * 用真实临时 store(经 env 构造,指向同一后端)+ 伪造 runtime(fake `session.agent`/`sessionId`)
 * 直接验证 hook 接上;不起子进程(集成接线验证,非端到端 e2e)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  createTempFileTracker,
  type TempFileTracker,
} from "../../src/attachment-bridge/index.js";
import {
  wireAttachmentBridge,
  ATTACHMENT_TOOL_CONTEXT_KEY,
  type WireAttachmentBridgeInput,
} from "../../src/runner/attachment-wiring.js";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "../../src/attachment-bridge/tool-context.js";

const SECRET = "stable-secret-for-wiring-test";
const SESSION_ID = "sess-owner";

let root: string;

/** 伪造的 pi `Agent`:仅持有可组合的两个 hook 属性(narrowing 目标的运行时载体)。 */
interface FakeAgent {
  beforeToolCall?: (
    ctx: { toolCall: { name: string; id: string }; args: unknown },
    signal?: AbortSignal,
  ) => Promise<{ block?: boolean; reason?: string } | undefined>;
  afterToolCall?: (
    ctx: {
      toolCall: { name: string; id: string };
      args: unknown;
      result: { content: unknown; details?: unknown };
      isError: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<
    { content?: unknown; details?: unknown; isError?: boolean; terminate?: boolean } | undefined
  >;
}

/** 伪造 runtime:仅暴露 `session.agent` 与 `sessionId`(本模块消费面)。 */
function fakeRuntime(agent: FakeAgent): AgentSessionRuntime {
  return {
    session: { agent, sessionId: SESSION_ID },
  } as unknown as AgentSessionRuntime;
}

/** 原始存储 env(供 attachmentStoreConfigFromEnv 构造「主进程」对照 store)。 */
function storeEnv(): NodeJS.ProcessEnv {
  return { [ATTACHMENT_DIR_ENV]: root, [ATTACHMENT_SECRET_ENV]: SECRET };
}

/** 装配入参(子进程 env 由 attachment-store 下发 + 当前 sessionId)。 */
function wireInput(): WireAttachmentBridgeInput {
  return { env: storeEnv(), sessionId: SESSION_ID };
}

async function seedAttachment(
  store: AttachmentStore,
  sessionId: string,
  bytes: number[],
) {
  return store.put({
    bytes: new Uint8Array(bytes),
    name: "in.png",
    mimeType: "image/png",
    size: bytes.length,
    sessionId,
    origin: "upload",
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attwire-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>)[ATTACHMENT_TOOL_CONTEXT_KEY];
});

describe("wireAttachmentBridge — 执行前闸门接到 agent.beforeToolCall(Req 5.1)", () => {
  it("他会话拥有的 attachmentId → block:true(越权阻断,不进既有 hook)", async () => {
    const { store: main } = attachmentStoreConfigFromEnv(storeEnv());
    // 该附件属于「他会话」,当前会话 sess-owner 无权解析。
    const foreign = await seedAttachment(main, "sess-other", [1, 2, 3]);

    const priorBefore = vi.fn().mockResolvedValue(undefined);
    const agent: FakeAgent = { beforeToolCall: priorBefore };
    wireAttachmentBridge(fakeRuntime(agent), wireInput());

    const result = await agent.beforeToolCall!({
      toolCall: { name: "edit_image", id: "call-1" },
      args: { attachmentId: foreign.id },
    });

    expect(result).toMatchObject({ block: true });
    // 阻断优先:既有 hook 不被调用。
    expect(priorBefore).not.toHaveBeenCalled();
  });

  it("本会话拥有的 attachmentId → 放行并委托既有 hook", async () => {
    const { store: main } = attachmentStoreConfigFromEnv(storeEnv());
    const owned = await seedAttachment(main, SESSION_ID, [9, 9, 9]);

    const priorBefore = vi.fn().mockResolvedValue(undefined);
    const agent: FakeAgent = { beforeToolCall: priorBefore };
    wireAttachmentBridge(fakeRuntime(agent), wireInput());

    const result = await agent.beforeToolCall!({
      toolCall: { name: "edit_image", id: "call-2" },
      args: { attachmentId: owned.id },
    });

    expect(result).toBeUndefined();
    expect(priorBefore).toHaveBeenCalledTimes(1);
  });

  it("无 attachmentId 的工具调用 → 放行并委托既有 hook(不阻断无关 tool)", async () => {
    const priorBefore = vi.fn().mockResolvedValue(undefined);
    const agent: FakeAgent = { beforeToolCall: priorBefore };
    wireAttachmentBridge(fakeRuntime(agent), wireInput());

    await agent.beforeToolCall!({
      toolCall: { name: "read", id: "call-3" },
      args: { path: "/x" },
    });
    expect(priorBefore).toHaveBeenCalledTimes(1);
  });
});

describe("wireAttachmentBridge — 结果出口闸门接到 agent.afterToolCall(Req 6.3)", () => {
  it("含内联 base64 图像的 tool result → 被剥离为文本引用,保留 text", async () => {
    const agent: FakeAgent = {};
    wireAttachmentBridge(fakeRuntime(agent), wireInput());

    const result = await agent.afterToolCall!({
      toolCall: { name: "edit_image", id: "call-4" },
      args: {},
      result: {
        content: [
          { type: "text", text: "done" },
          { type: "image", data: "QUJD", mimeType: "image/png" },
        ],
        details: { outputAttachmentId: "att_xyz" },
      },
      isError: false,
    });

    const content = result?.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content).toBeDefined();
    // 图像被剥离:不再出现 image 项 / base64 data。
    expect(content.some((c) => c.type === "image")).toBe(false);
    expect(JSON.stringify(content)).not.toContain("QUJD");
    // text 保留 + 注入引用文本(含产出 id)。
    expect(content.some((c) => c.type === "text" && c.text === "done")).toBe(true);
    expect(JSON.stringify(content)).toContain("att_xyz");
  });

  it("无内联 base64 的结果 → 原样透传(既有 hook 结果)", async () => {
    const priorAfter = vi.fn().mockResolvedValue(undefined);
    const agent: FakeAgent = { afterToolCall: priorAfter };
    wireAttachmentBridge(fakeRuntime(agent), wireInput());

    const result = await agent.afterToolCall!({
      toolCall: { name: "read", id: "call-5" },
      args: {},
      result: { content: [{ type: "text", text: "no image" }] },
      isError: false,
    });
    expect(result).toBeUndefined();
    expect(priorAfter).toHaveBeenCalledTimes(1);
  });
});

describe("wireAttachmentBridge — tool 接入上下文经 globalThis seam 透给 customTools(Req 3.3)", () => {
  it("seam 上挂 available:true 的 ctx,能 resolve 本会话附件并 putOutput", async () => {
    const { store: main } = attachmentStoreConfigFromEnv(storeEnv());
    const owned = await seedAttachment(main, SESSION_ID, [4, 5, 6, 7]);

    const wiring = wireAttachmentBridge(fakeRuntime({}), wireInput());
    expect(wiring.available).toBe(true);

    const ctx = (globalThis as Record<string, unknown>)[
      ATTACHMENT_TOOL_CONTEXT_KEY
    ] as AttachmentToolContext;
    expect(ctx).toBeDefined();
    expect(ctx.available).toBe(true);

    // resolve 本会话附件 → 句柄字节往返一致。
    const handle = await ctx.resolve(owned.id);
    expect([...(await handle.bytes())]).toEqual([4, 5, 6, 7]);

    // putOutput 落库(origin tool-output)→ 主进程按 id 可读。
    const ref = await ctx.putOutput({
      bytes: new Uint8Array([1, 1]),
      name: "out.png",
      mimeType: "image/png",
    });
    expect(ref.attachmentId.startsWith("att_")).toBe(true);
    const head = await main.head(ref.attachmentId);
    expect(head?.origin).toBe("tool-output");
    expect(head?.sessionId).toBe(SESSION_ID);
  });

  it("env 缺失 → seam 上 ctx.available=false(优雅降级,不崩溃)", () => {
    const wiring = wireAttachmentBridge(fakeRuntime({}), {
      env: { [ATTACHMENT_SECRET_ENV]: SECRET }, // 无 DIR
      sessionId: SESSION_ID,
    });
    expect(wiring.available).toBe(false);
    const ctx = (globalThis as Record<string, unknown>)[
      ATTACHMENT_TOOL_CONTEXT_KEY
    ] as AttachmentToolContext;
    expect(ctx.available).toBe(false);
  });
});

describe("wireAttachmentBridge — publish 落库 + fd1 事件帧广播(agent-attachment-catalog spec,Req 4.1)", () => {
  it("seam ctx.publish 落库并经注入的 publishEventWrite 写出 piweb_attachment_event 帧", async () => {
    const lines: string[] = [];
    const wiring = wireAttachmentBridge(fakeRuntime({}), {
      ...wireInput(),
      publishEventWrite: (line) => lines.push(line),
    });
    expect(wiring.available).toBe(true);

    const ctx = (globalThis as Record<string, unknown>)[
      ATTACHMENT_TOOL_CONTEXT_KEY
    ] as AttachmentToolContext;
    const ref = await ctx.publish({
      bytes: new Uint8Array([2, 2, 2]),
      name: "pushed.png",
      mimeType: "image/png",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    const frame = JSON.parse(lines[0]!) as {
      type: string;
      event: string;
      attachment: { id: string };
    };
    expect(frame.type).toBe("piweb_attachment_event");
    expect(frame.event).toBe("added");
    expect(frame.attachment.id).toBe(ref.attachmentId);
  });
});

describe("wireAttachmentBridge — writeProfile 透传给 createChildAttachmentStore(agent-attachment-profile spec,Req 3.2)", () => {
  it("input.writeProfile 静态覆盖多后端拓扑写路由,putOutput 落到指定后端", async () => {
    const rootB = await mkdtemp(join(tmpdir(), "attwire-b-"));
    try {
      const topology = JSON.stringify({
        backends: [
          { kind: "local-fs", name: "primary", dir: root },
          { kind: "local-fs", name: "secondary", dir: rootB },
        ],
        write: "primary",
      });
      const wiring = wireAttachmentBridge(fakeRuntime({}), {
        env: {
          [ATTACHMENT_DIR_ENV]: root,
          [ATTACHMENT_SECRET_ENV]: SECRET,
          PI_WEB_ATTACHMENT_BACKENDS: topology,
        },
        sessionId: SESSION_ID,
        writeProfile: "secondary",
      });
      expect(wiring.available).toBe(true);

      const ctx = (globalThis as Record<string, unknown>)[
        ATTACHMENT_TOOL_CONTEXT_KEY
      ] as AttachmentToolContext;
      const ref = await ctx.putOutput({
        bytes: new Uint8Array([2, 2]),
        name: "out.png",
        mimeType: "image/png",
      });

      const { store: main } = attachmentStoreConfigFromEnv({
        [ATTACHMENT_DIR_ENV]: root,
        [ATTACHMENT_SECRET_ENV]: SECRET,
        PI_WEB_ATTACHMENT_BACKENDS: topology,
      });
      const head = await main.head(ref.attachmentId);
      expect(head?.backend).toBe("secondary");
    } finally {
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it("不传 writeProfile = 现状:走拓扑默认 write(既有测试零改动的结构性证明)", async () => {
    const { store: main } = attachmentStoreConfigFromEnv(storeEnv());
    const owned = await seedAttachment(main, SESSION_ID, [1, 2]);
    const wiring = wireAttachmentBridge(fakeRuntime({}), wireInput());
    expect(wiring.available).toBe(true);
    expect(owned.id).toMatch(/^att_/);
  });
});

describe("wireAttachmentBridge — 会话结束触发 cleanupForSession(Req 2.3)", () => {
  it("cleanup() 调用 tracker.cleanupForSession(sessionId) 并清理 seam", async () => {
    const tracker: TempFileTracker = createTempFileTracker();
    const spy = vi.spyOn(tracker, "cleanupForSession");

    const input: WireAttachmentBridgeInput = {
      env: storeEnv(),
      sessionId: SESSION_ID,
      tracker,
    };
    const wiring = wireAttachmentBridge(fakeRuntime({}), input);

    // seam 在装配后存在。
    expect(
      (globalThis as Record<string, unknown>)[ATTACHMENT_TOOL_CONTEXT_KEY],
    ).toBeDefined();

    await wiring.cleanup();

    expect(spy).toHaveBeenCalledWith(SESSION_ID);
    // seam 被清理(避免跨会话泄漏)。
    expect(
      (globalThis as Record<string, unknown>)[ATTACHMENT_TOOL_CONTEXT_KEY],
    ).toBeUndefined();
  });

  it("cleanup() 幂等:重复调用只回收一次", async () => {
    const tracker: TempFileTracker = createTempFileTracker();
    const spy = vi.spyOn(tracker, "cleanupForSession");
    const wiring = wireAttachmentBridge(fakeRuntime({}), {
      env: storeEnv(),
      sessionId: SESSION_ID,
      tracker,
    });
    await wiring.cleanup();
    await wiring.cleanup();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

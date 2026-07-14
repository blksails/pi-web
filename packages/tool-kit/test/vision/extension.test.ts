/**
 * 集成:visionExtension 装配、工具结果形状、命令呈现(Req 4.1/4.2/5.2/5.3/5.4/6.2–6.5/7.2/7.3/7.4)。
 *
 * 手法沿用 `test/aigc/canvas-extra-commands.test.ts` 的 `registerCommand: vi.fn()` 探针。
 */
import { describe, expect, it, vi } from "vitest";
import { makeVisionExtension, visionExtension } from "../../src/vision/extension.js";
import { notifyResult } from "../../src/vision/command.js";
import { toToolResult } from "../../src/vision/tools/image-vision.js";
import { fail } from "../../src/vision/errors.js";
import type { VisionFailureReason, VisionResult } from "../../src/vision/types.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fakeAttCtx, fakeCtx, fakeRegistry, model } from "./fixtures.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e]);
const VISION_A = model("apiservices", "gpt-5.4");

interface Probe {
  readonly pi: ExtensionAPI;
  readonly registerTool: ReturnType<typeof vi.fn>;
  readonly registerCommand: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
}

function probe(): Probe {
  const registerTool = vi.fn();
  const registerCommand = vi.fn();
  const on = vi.fn();
  return {
    pi: { registerTool, registerCommand, on } as unknown as ExtensionAPI,
    registerTool,
    registerCommand,
    on,
  };
}

function okMessage(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }] } as AssistantMessage;
}

const testDeps = {
  complete: async () => okMessage("一只橘猫"),
  getAttachmentCtx: () =>
    fakeAttCtx({ blobs: { att_a: { bytes: PNG_BYTES, mimeType: "image/png" } } }),
  defaultModel: () => undefined,
} as const;

describe("visionExtension 装配(7.3 / 7.4)", () => {
  it("注册 image_vision 工具与 img_vision 命令各一次", () => {
    const p = probe();
    makeVisionExtension(testDeps)(p.pi);

    expect(p.registerTool).toHaveBeenCalledTimes(1);
    expect(p.registerCommand).toHaveBeenCalledTimes(1);
    expect(p.registerTool.mock.calls[0]?.[0]?.name).toBe("image_vision");
    expect(p.registerCommand.mock.calls[0]?.[0]).toBe("img_vision");
  });

  it("不注册任何事件钩子 ⇒ 对话流零影响(7.3)", () => {
    const p = probe();
    makeVisionExtension(testDeps)(p.pi);
    expect(p.on).not.toHaveBeenCalled();
  });

  it("模块顶层无副作用:import 不注册,仅调用 factory 才注册(7.4)", () => {
    const p = probe();
    // `extension.ts` 已在本文件顶部被 import(模块求值完毕)。若它在顶层做了注册
    // 或其它副作用,「未装载 = 该能力不存在」就不成立。
    expect(p.registerTool).not.toHaveBeenCalled();
    expect(p.registerCommand).not.toHaveBeenCalled();

    // visionExtension 是惰性 factory:只有被 AgentDefinition.extensions 调用时才注册。
    expect(typeof visionExtension).toBe("function");
    visionExtension(p.pi);

    expect(p.registerTool).toHaveBeenCalledTimes(1);
    expect(p.registerCommand).toHaveBeenCalledTimes(1);
    expect(p.on).not.toHaveBeenCalled();
  });
});

describe("image_vision 工具 execute(5.2 / 5.3 / 5.4)", () => {
  it("成功:content 仅含文本段,details 承载完整结果", async () => {
    const p = probe();
    makeVisionExtension(testDeps)(p.pi);
    const tool = p.registerTool.mock.calls[0]?.[0] as {
      execute: (
        id: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown,
      ) => Promise<{ content: Array<{ type: string }>; details: VisionResult }>;
    };

    const { ctx } = fakeCtx({ registry: fakeRegistry({ available: [VISION_A] }) });
    const res = await tool.execute("call1", { image: "att_a", question: "什么猫？" }, undefined, undefined, ctx);

    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toEqual({ type: "text", text: "一只橘猫" });
    // 不得出现内联 ImageContent(会被服务端 base64 闸门剥离)。
    expect(res.content.some((c) => c.type === "image")).toBe(false);
    expect(res.details).toMatchObject({ ok: true, model: "apiservices/gpt-5.4" });
  });

  it("失败:content 仍是文本,携带 reason", () => {
    const res = toToolResult(fail("no_vision_model", "没有可用模型"));
    expect(res.content[0]?.type).toBe("text");
    expect((res.content[0] as { text: string }).text).toContain("no_vision_model");
    expect(res.details).toMatchObject({ ok: false, reason: "no_vision_model" });
  });
});

describe("/img_vision 命令(6.2 / 6.3 / 6.4)", () => {
  it("命令 handler 经 ctx.ui.notify 呈现结论,返回 undefined 且不抛", async () => {
    const p = probe();
    makeVisionExtension({
      ...testDeps,
      getAttachmentCtx: () =>
        fakeAttCtx({
          list: [
            {
              id: "att_a",
              name: "a.png",
              mimeType: "image/png",
              size: 3,
              origin: "upload",
              sessionId: "s1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          blobs: { att_a: { bytes: PNG_BYTES, mimeType: "image/png" } },
        }),
    })(p.pi);

    const cmd = p.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const { ctx, notify } = fakeCtx({ registry: fakeRegistry({ available: [VISION_A] }) });

    await expect(cmd.handler("这是什么猫？", ctx)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith("一只橘猫", "info");
  });

  it("args 为空时使用默认提问,仍成功呈现", async () => {
    const p = probe();
    makeVisionExtension({
      ...testDeps,
      getAttachmentCtx: () =>
        fakeAttCtx({
          list: [
            {
              id: "att_a",
              name: "a.png",
              mimeType: "image/png",
              size: 3,
              origin: "upload",
              sessionId: "s1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          blobs: { att_a: { bytes: PNG_BYTES, mimeType: "image/png" } },
        }),
    })(p.pi);
    const cmd = p.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const { ctx, notify } = fakeCtx({ registry: fakeRegistry({ available: [VISION_A] }) });

    await cmd.handler("   ", ctx);
    expect(notify).toHaveBeenCalledWith("一只橘猫", "info");
  });

  it("内核失败时以 error 级 notify;handler 不抛(7.1)", async () => {
    const p = probe();
    makeVisionExtension({ ...testDeps, getAttachmentCtx: () => fakeAttCtx({ available: false }) })(p.pi);
    const cmd = p.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const { ctx, notify } = fakeCtx({ registry: fakeRegistry({ available: [VISION_A] }) });

    await expect(cmd.handler("看图", ctx)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe("error");
  });
});

describe("notifyResult 级别映射", () => {
  it("成功 → info", () => {
    const notify = vi.fn();
    notifyResult({ notify } as never, { ok: true, text: "结论", model: "p/m" });
    expect(notify).toHaveBeenCalledWith("结论", "info");
  });

  it("cancelled / aborted → info(用户意图,不是故障)", () => {
    for (const reason of ["cancelled", "aborted"] as const) {
      const notify = vi.fn();
      notifyResult({ notify } as never, fail(reason));
      expect(notify.mock.calls[0]?.[1]).toBe("info");
    }
  });

  it("其余失败 → error", () => {
    for (const reason of ["no_image", "call_failed", "model_auth_failed"] as const) {
      const notify = vi.fn();
      notifyResult({ notify } as never, fail(reason));
      expect(notify.mock.calls[0]?.[1]).toBe("error");
    }
  });
});

describe("VisionFailureReason 可区分性(7.2)", () => {
  it("十种失败原因两两互斥,且均可从结果中读出", () => {
    const reasons: VisionFailureReason[] = [
      "attachment_unavailable",
      "no_image",
      "attachment_not_found",
      "not_an_image",
      "no_vision_model",
      "unknown_model",
      "cancelled",
      "aborted",
      "model_auth_failed",
      "call_failed",
    ];
    expect(new Set(reasons).size).toBe(10);
    for (const r of reasons) {
      const f = fail(r);
      expect(f.ok).toBe(false);
      expect(f.reason).toBe(r);
    }
  });
});

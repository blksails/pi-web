/**
 * 单元:vision 识别内核(Req 5.1, 5.4, 5.5, 5.6, 7.1)。
 *
 * ★ 头号回归锁(「关键决策 1」):`completeSimple` 内部仅在 `options.apiKey` 缺省时回落
 *   **环境变量**;目标 provider 的凭据只存在于 `models.json`。故内核**必须**先
 *   `registry.getApiKeyAndHeaders(model)` 再把 apiKey/headers/env 显式传入。
 *   若有人「照抄 auto-title」把 options 省掉,下面第一个用例立刻红。
 *
 * ★ 次要回归锁(「关键决策 2」):送模型的 image part `data` 必须是裸 base64(无 data: 前缀)。
 */
import { describe, expect, it, vi } from "vitest";
import { createVisionRunner, extractText } from "../../src/vision/run-vision-tool.js";
import type { CompleteFn, VisionRunnerDeps } from "../../src/vision/types.js";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  abortedSignal,
  fakeAttCtx,
  fakeCtx,
  fakeRegistry,
  model,
} from "./fixtures.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");
const VISION_A = model("apiservices", "gpt-5.4");

/** 带完整形参签名的 complete mock —— 使 `mock.calls[0][2]` 具备正确元组类型。 */
function completeMock(impl: () => AssistantMessage) {
  return vi.fn(
    async (_model: Model<Api>, _context: Context, _options: SimpleStreamOptions) => impl(),
  );
}

function okMessage(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }] } as AssistantMessage;
}

function deps(over: Partial<VisionRunnerDeps> = {}): VisionRunnerDeps {
  return {
    complete: vi.fn(async () => okMessage("图里有两只猫")) as unknown as CompleteFn,
    getAttachmentCtx: () =>
      fakeAttCtx({ blobs: { att_a: { bytes: PNG_BYTES, mimeType: "image/png" } } }),
    defaultModel: () => undefined,
    ...over,
  };
}

describe("createVisionRunner — 成功路径", () => {
  it("★ 显式传入 registry 解析出的 apiKey/headers/env(关键决策 1)", async () => {
    const complete = completeMock(() => okMessage("结论"));
    const registry = fakeRegistry({
      available: [VISION_A],
      auth: { ok: true, apiKey: "sk-from-models-json", headers: { "X-Gw": "1" }, env: { R: "cn" } },
    });
    const { ctx } = fakeCtx({ registry, hasUI: false });

    const run = createVisionRunner(deps({ complete: complete as unknown as CompleteFn }));
    const res = await run({ image: "att_a", question: "几只猫？" }, ctx, undefined);

    expect(res.ok).toBe(true);
    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledTimes(1);

    const options = complete.mock.calls[0]![2];
    expect(options.apiKey).toBe("sk-from-models-json");
    expect(options.headers).toEqual({ "X-Gw": "1" });
    expect(options.env).toEqual({ R: "cn" });
  });

  it("★ 消息为「文本 + 图像」两段,图像 data 是裸 base64(关键决策 2)", async () => {
    const complete = completeMock(() => okMessage("结论"));
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });

    const run = createVisionRunner(deps({ complete: complete as unknown as CompleteFn }));
    await run({ image: "att_a", question: "几只猫？" }, ctx, undefined);

    const context = complete.mock.calls[0]![1];
    const content = context.messages[0]?.content as unknown as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "几只猫？" });
    expect(content[1]?.["type"]).toBe("image");
    expect(content[1]?.["mimeType"]).toBe("image/png");
    expect(content[1]?.["data"]).toBe(PNG_B64);
    expect(String(content[1]?.["data"]).startsWith("data:")).toBe(false);
  });

  it("结果含文字结论与所用模型标识,不含图像字节(5.2 / 5.3 / 5.4)", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(deps());

    const res = await run({ image: "att_a", question: "?" }, ctx, undefined);

    expect(res).toEqual({ ok: true, text: "图里有两只猫", model: "apiservices/gpt-5.4" });
    expect(JSON.stringify(res)).not.toContain(PNG_B64);
  });
});

describe("createVisionRunner — 失败路径均不抛出(7.1)", () => {
  it("附件能力不可用 → attachment_unavailable,且不触碰 registry", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(deps({ getAttachmentCtx: () => fakeAttCtx({ available: false }) }));

    const res = await run({ question: "?" }, ctx, undefined);

    expect(res).toEqual({
      ok: false,
      reason: "attachment_unavailable",
      detail: expect.any(String),
    });
    expect(registry.getAvailable).not.toHaveBeenCalled();
  });

  it("凭据解析失败 → model_auth_failed(区别于 call_failed)", async () => {
    const complete = vi.fn();
    const registry = fakeRegistry({
      available: [VISION_A],
      auth: { ok: false, error: "No API key found for apiservices" },
    });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(deps({ complete: complete as unknown as CompleteFn }));

    const res = await run({ image: "att_a", question: "?" }, ctx, undefined);

    expect(res).toMatchObject({ ok: false, reason: "model_auth_failed" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("模型调用抛错 → call_failed(5.5)", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(
      deps({
        complete: (async () => {
          throw new Error("gateway 502");
        }) as unknown as CompleteFn,
      }),
    );

    const res = await run({ image: "att_a", question: "?" }, ctx, undefined);
    expect(res).toMatchObject({ ok: false, reason: "call_failed", detail: "gateway 502" });
  });

  it("模型返回空文本 → call_failed(5.5)", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(
      deps({ complete: (async () => okMessage("   ")) as unknown as CompleteFn }),
    );

    const res = await run({ image: "att_a", question: "?" }, ctx, undefined);
    expect(res).toMatchObject({ ok: false, reason: "call_failed" });
  });

  it("开始前已中止 → aborted,且不取图不调模型(5.6)", async () => {
    const complete = vi.fn();
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(deps({ complete: complete as unknown as CompleteFn }));

    const res = await run({ image: "att_a", question: "?" }, ctx, abortedSignal());

    expect(res).toMatchObject({ ok: false, reason: "aborted" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("signal 透传给模型调用(5.6)", async () => {
    const complete = completeMock(() => okMessage("ok"));
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const signal = new AbortController().signal;
    const run = createVisionRunner(deps({ complete: complete as unknown as CompleteFn }));

    await run({ image: "att_a", question: "?" }, ctx, signal);

    const options = complete.mock.calls[0]![2];
    expect(options.signal).toBe(signal);
  });

  it("取图失败原样透传(no_image),不被吞成 call_failed", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(deps({ getAttachmentCtx: () => fakeAttCtx({ list: [] }) }));

    const res = await run({ question: "?" }, ctx, undefined);
    expect(res).toMatchObject({ ok: false, reason: "no_image" });
  });

  it("内核对未预期异常兜底,永不抛出(7.1)", async () => {
    const registry = fakeRegistry({ available: [VISION_A] });
    const { ctx } = fakeCtx({ registry });
    const run = createVisionRunner(
      deps({
        getAttachmentCtx: () => {
          throw new Error("seam exploded");
        },
      }),
    );

    await expect(run({ question: "?" }, ctx, undefined)).resolves.toMatchObject({
      ok: false,
      reason: "call_failed",
    });
  });
});

describe("extractText", () => {
  it("拼接全部 text 段并 trim", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: " 前" },
        { type: "thinking", text: "不该被算入" },
        { type: "text", text: "后 " },
      ],
    } as unknown as AssistantMessage;
    expect(extractText(msg)).toBe("前后");
  });

  it("content 为字符串时直接返回", () => {
    expect(extractText({ role: "assistant", content: " hi " } as unknown as AssistantMessage)).toBe("hi");
  });

  it("无文本段返回空串", () => {
    const msg = { role: "assistant", content: [{ type: "thinking", text: "x" }] } as unknown as AssistantMessage;
    expect(extractText(msg)).toBe("");
  });
});

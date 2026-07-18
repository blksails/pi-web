/**
 * 单元:vision 模型候选、交互选择与降级链(Req 2.1–2.4, 3.1–3.4, 4.1–4.5)。
 *
 * 两条关键回归锁:
 *  - 候选取自 `getAvailable()` 而非 `getAll()`(否则会列出用户选不了的无凭据模型)。
 *  - `hasUI === false` 时 `ui.select` 调用次数必须为 0(否则 headless 场景会挂起)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  listVisionModels,
  modelKey,
  selectVisionModel,
} from "../../src/vision/select-model.js";
import type { VisionFail } from "../../src/vision/types.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fakeRegistry, model } from "./fixtures.js";

const VISION_A = model("apiservices", "gpt-5.4");
const VISION_B = model("apiservices", "gpt-5.4-mini");
const TEXT_ONLY = model("dashscope", "qwen3.7-max", ["text"]);
/** 只出现在 getAll 中(无凭据),绝不应入选。 */
const NO_AUTH_VISION = model("ghost", "ghost-vision");

function asFail(v: Model<Api> | VisionFail): VisionFail {
  if (!("ok" in v)) throw new Error("expected fail, got model");
  return v as VisionFail;
}
function asModel(v: Model<Api> | VisionFail): Model<Api> {
  if ("ok" in v) throw new Error(`expected model, got ${(v as VisionFail).reason}`);
  return v as Model<Api>;
}

describe("listVisionModels", () => {
  it("过滤掉纯文本模型,只留支持图像输入的(2.1)", () => {
    const reg = fakeRegistry({ available: [VISION_A, TEXT_ONLY, VISION_B] });
    expect(listVisionModels(reg).map(modelKey)).toEqual([
      "apiservices/gpt-5.4",
      "apiservices/gpt-5.4-mini",
    ]);
  });

  it("使用 getAvailable 而非 getAll:无凭据的视觉模型不得入选(2.2)", () => {
    const reg = fakeRegistry({
      available: [VISION_A],
      all: [VISION_A, NO_AUTH_VISION],
    });
    const keys = listVisionModels(reg).map(modelKey);
    expect(keys).toEqual(["apiservices/gpt-5.4"]);
    expect(keys).not.toContain("ghost/ghost-vision");
    expect(reg.getAll).not.toHaveBeenCalled();
  });

  it("新增的图像输入模型自动成为候选,无静态清单(2.3)", () => {
    const fresh = model("newprov", "brand-new-vlm");
    const reg = fakeRegistry({ available: [VISION_A, fresh] });
    expect(listVisionModels(reg).map(modelKey)).toContain("newprov/brand-new-vlm");
  });
});

describe("selectVisionModel — 候选为空", () => {
  it("无候选 → no_vision_model(2.4 / 4.5)", async () => {
    const reg = fakeRegistry({ available: [TEXT_ONLY] });
    const select = vi.fn();
    const got = asFail(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(got.reason).toBe("no_vision_model");
    expect(select).not.toHaveBeenCalled();
  });
});

describe("selectVisionModel — 显式指定模型", () => {
  it("命中候选 → 直接使用,不提示选择(3.2)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const select = vi.fn();
    const got = asModel(
      await selectVisionModel({
        requested: "apiservices/gpt-5.4-mini",
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
    expect(select).not.toHaveBeenCalled();
  });

  it("不在候选 → unknown_model,不静默回退(3.4)", async () => {
    const reg = fakeRegistry({ available: [VISION_A] });
    const got = asFail(
      await selectVisionModel({
        requested: "apiservices/nope",
        registry: reg,
        ui: undefined,
        hasUI: false,
        defaultModel: undefined,
      }),
    );
    expect(got.reason).toBe("unknown_model");
  });
});

/**
 * 已配置默认模型 → 不问,直接用(4.3)。
 *
 * 顺序回归护栏:`hasUI` 只说明会话有 UI 能力,不说明有人在看。无人值守通道
 * (pi-gateway 企微等)hasUI=true 但没人点弹层 → `await ui.select` 永不 resolve,
 * 工具静默挂死。若有人把默认模型判定挪回 UI 分支之后,这两条会失败。
 */
describe("selectVisionModel — 已配置默认模型优先于弹层", () => {
  it("有 UI 但已配置默认模型 → 绝不弹层,直接用默认(4.3)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const select = vi.fn(async (_t: string, opts: string[]) => opts[0]);
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: "apiservices/gpt-5.4-mini",
      }),
    );
    expect(select).toHaveBeenCalledTimes(0);
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
  });

  it("显式指定仍优先于已配置的默认模型(3.2)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const select = vi.fn();
    const got = asModel(
      await selectVisionModel({
        requested: "apiservices/gpt-5.4",
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: "apiservices/gpt-5.4-mini",
      }),
    );
    expect(select).toHaveBeenCalledTimes(0);
    expect(modelKey(got)).toBe("apiservices/gpt-5.4");
  });

  it("默认模型不在候选中 → 回退到弹层,不静默改用他者", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const select = vi.fn(async (_t: string, opts: string[]) => opts[0]);
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: "ghost/not-there",
      }),
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(modelKey(got)).toBe("apiservices/gpt-5.4");
  });
});

describe("selectVisionModel — 交互式选择", () => {
  it("有 UI 且未指定 → 提示一次并采用选中项(3.1)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const select = vi.fn(async (_t: string, opts: string[]) => opts[1]);
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
  });

  it("用户取消(select 返回 undefined) → cancelled(3.3)", async () => {
    const reg = fakeRegistry({ available: [VISION_A] });
    const got = asFail(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select: vi.fn(async () => undefined) } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(got.reason).toBe("cancelled");
  });

  it("select 抛错 → cancelled,异常不外泄", async () => {
    const reg = fakeRegistry({ available: [VISION_A] });
    const got = asFail(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: {
          select: vi.fn(async () => {
            throw new Error("boom");
          }),
        } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(got.reason).toBe("cancelled");
  });

  it("select 返回非候选字符串 → cancelled,不猜测用户意图", async () => {
    const reg = fakeRegistry({ available: [VISION_A] });
    const got = asFail(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: { select: vi.fn(async () => "某个不存在的标签") } as never,
        hasUI: true,
        defaultModel: undefined,
      }),
    );
    expect(got.reason).toBe("cancelled");
  });
});

describe("selectVisionModel — 无 UI 降级链(4.1–4.4)", () => {
  it("绝不调用 ui.select(4.1)", async () => {
    const reg = fakeRegistry({ available: [VISION_A] });
    const select = vi.fn();
    await selectVisionModel({
      requested: undefined,
      registry: reg,
      // 即便误传了 ui,hasUI=false 也必须不碰它。
      ui: { select } as never,
      hasUI: false,
      defaultModel: undefined,
    });
    expect(select).toHaveBeenCalledTimes(0);
  });

  it("显式模型优先(4.2)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const got = asModel(
      await selectVisionModel({
        requested: "apiservices/gpt-5.4-mini",
        registry: reg,
        ui: undefined,
        hasUI: false,
        defaultModel: "apiservices/gpt-5.4",
      }),
    );
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
  });

  it("未指定 → 采用 env 默认模型(4.3)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: undefined,
        hasUI: false,
        defaultModel: "apiservices/gpt-5.4-mini",
      }),
    );
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
  });

  it("env 默认模型不在候选 → 退到候选首个(4.4)", async () => {
    const reg = fakeRegistry({ available: [VISION_A, VISION_B] });
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: undefined,
        hasUI: false,
        defaultModel: "ghost/not-there",
      }),
    );
    expect(modelKey(got)).toBe("apiservices/gpt-5.4");
  });

  it("无默认模型 → 取候选首个(4.4)", async () => {
    const reg = fakeRegistry({ available: [VISION_B, VISION_A] });
    const got = asModel(
      await selectVisionModel({
        requested: undefined,
        registry: reg,
        ui: undefined,
        hasUI: false,
        defaultModel: undefined,
      }),
    );
    expect(modelKey(got)).toBe("apiservices/gpt-5.4-mini");
  });
});

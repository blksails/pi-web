/**
 * 单元:Canvas 解读载荷构造器 `buildVisionOp`(spec canvas-vision-readout,Req 1.3 / 3.3 / 3.4)。
 *
 * 三条回归锁:
 *  ① **围栏隐性契约**:tool 行必须内嵌中文指令,fence 恒 `canvas-op`。
 *     agent 的 systemPrompt 没教 LLM 解析该围栏,理解全靠这行指令。
 *  ② **空 model 不产生参数行** —— 否则工具收到空 model 会报 `unknown_model`,而不是弹层。
 *  ③ **参数顺序 image → question → model** —— 渲染输出确定性。
 */
import { describe, expect, it, vi } from "vitest";
import { renderSurfaceOp } from "@blksails/pi-web-kit";
import {
  buildVisionOp,
  fetchVisionModels,
  DEFAULT_READOUT_QUESTION,
} from "../src/vision-op.js";

const IMG = "att_abc123";

describe("buildVisionOp — 围栏隐性契约(回归锁 ①)", () => {
  it("tool 行以 image_vision 开头且内嵌中文指令", () => {
    const op = buildVisionOp({ imageId: IMG, question: "什么颜色？" });
    expect(op.tool.startsWith("image_vision")).toBe(true);
    expect(op.tool).toContain("请直接按下列参数调用");
    expect(op.tool).toContain("勿追问");
  });

  it("fence 恒为 canvas-op(与生成载荷一致)", () => {
    expect(buildVisionOp({ imageId: IMG, question: "?" }).fence).toBe("canvas-op");
  });

  it("绝不产生 image_edit 的 tool 行", () => {
    const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "?" }));
    expect(text).toContain("tool: image_vision");
    expect(text).not.toContain("image_edit");
  });
});

describe("buildVisionOp — model 参数(回归锁 ②)", () => {
  it("省略 model → 渲染文本不含 model 行(交由工具弹层,3.4)", () => {
    const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "?" }));
    expect(text).not.toMatch(/^model:/m);
  });

  it("空串 / 全空白 model → 同样不含 model 行", () => {
    for (const model of ["", "   "]) {
      const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "?", model }));
      expect(text, `model=${JSON.stringify(model)}`).not.toMatch(/^model:/m);
    }
  });

  it("非空 model → 含 `model: provider/id`,原样透传(3.3)", () => {
    const text = renderSurfaceOp(
      buildVisionOp({ imageId: IMG, question: "?", model: "apiservices/gpt-5.4" }),
    );
    expect(text).toContain("model: apiservices/gpt-5.4");
  });
});

describe("buildVisionOp — 参数顺序(回归锁 ③)", () => {
  it("顺序恒为 image → question → model", () => {
    const op = buildVisionOp({ imageId: IMG, question: "几只猫？", model: "p/m" });
    expect(op.params.map(([k]) => k)).toEqual(["image", "question", "model"]);
  });

  it("无 model 时顺序为 image → question", () => {
    const op = buildVisionOp({ imageId: IMG, question: "几只猫？" });
    expect(op.params.map(([k]) => k)).toEqual(["image", "question"]);
  });

  it("image 取当前工作图 id", () => {
    const op = buildVisionOp({ imageId: IMG, question: "?" });
    expect(op.params[0]).toEqual(["image", IMG]);
  });
});

describe("buildVisionOp — 默认提问(1.3)", () => {
  it("空问题 → 使用默认提问", () => {
    const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "" }));
    expect(text).toContain(`question: ${DEFAULT_READOUT_QUESTION}`);
  });

  it("全空白问题 → 使用默认提问", () => {
    const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "   \n " }));
    expect(text).toContain(`question: ${DEFAULT_READOUT_QUESTION}`);
  });

  it("非空问题 → 原样透传(不 trim 内部内容)", () => {
    const text = renderSurfaceOp(buildVisionOp({ imageId: IMG, question: "这只猫戴的什么帽子？" }));
    expect(text).toContain("question: 这只猫戴的什么帽子？");
  });
});

describe("buildVisionOp — 标题", () => {
  it("带意图摘要", () => {
    expect(buildVisionOp({ imageId: IMG, question: "什么颜色？" }).title).toBe("👁 解读 · 什么颜色？");
  });

  it("超长意图截断到 48 字并加省略号", () => {
    const long = "很".repeat(60);
    const title = buildVisionOp({ imageId: IMG, question: long }).title;
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(60);
  });

  it("空问题 → 标题用默认提问的摘要", () => {
    expect(buildVisionOp({ imageId: IMG, question: "" }).title).toContain("解读");
  });
});

describe("buildVisionOp — 纯函数", () => {
  it("同输入恒同输出,且不改动入参", () => {
    const input = { imageId: IMG, question: "?", model: "p/m" } as const;
    const a = buildVisionOp(input);
    const b = buildVisionOp(input);
    expect(renderSurfaceOp(a)).toBe(renderSurfaceOp(b));
    expect(input).toEqual({ imageId: IMG, question: "?", model: "p/m" });
  });
});

// ── fetchVisionModels(Req 3.1 / 3.6)─────────────────────────────────────────
// reviewer 首轮指出:useVisionModels 的 fetch 分支**零测试覆盖**。抽成纯函数后逐条锁死。
// 不变式:**任何失败都折成空数组,绝不抛出** —— 否则解读按钮会被拖垮(3.6)。

function okRes(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe("fetchVisionModels — 成功分支(3.1)", () => {
  it("2xx + 合法 models → 原样返回", async () => {
    const models = [{ value: "p/m", label: "M", provider: "p" }];
    const got = await fetchVisionModels("/api", async () => okRes({ models }));
    expect(got).toEqual(models);
  });

  it("过滤掉形状不合法的项(缺 value / label)", async () => {
    const got = await fetchVisionModels("/api", async () =>
      okRes({ models: [{ value: "p/m", label: "M", provider: "p" }, { value: 1 }, null, {}] }),
    );
    expect(got).toEqual([{ value: "p/m", label: "M", provider: "p" }]);
  });

  it("请求路径为 `${baseUrl}/vision/models`", async () => {
    const spy = vi.fn(async () => okRes({ models: [] }));
    await fetchVisionModels("/api", spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalledWith("/api/vision/models");
  });
});

describe("★ fetchVisionModels — 一切失败都折成空数组,绝不抛出(3.6)", () => {
  it("baseUrl 缺省 / 空串 → [] 且不发请求", async () => {
    const spy = vi.fn();
    for (const base of [undefined, ""]) {
      await expect(fetchVisionModels(base, spy as unknown as typeof fetch)).resolves.toEqual([]);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("非 2xx → []", async () => {
    const got = await fetchVisionModels("/api", async () => ({ ok: false }) as Response);
    expect(got).toEqual([]);
  });

  it("网络错误(fetch 抛) → [],不外泄异常", async () => {
    await expect(
      fetchVisionModels("/api", async () => {
        throw new Error("network down");
      }),
    ).resolves.toEqual([]);
  });

  it("响应体非法 JSON(json() 抛) → []", async () => {
    const got = await fetchVisionModels("/api", async () =>
      ({
        ok: true,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      }) as unknown as Response,
    );
    expect(got).toEqual([]);
  });

  it("models 不是数组 → []", async () => {
    expect(await fetchVisionModels("/api", async () => okRes({ models: "nope" }))).toEqual([]);
    expect(await fetchVisionModels("/api", async () => okRes({}))).toEqual([]);
  });
});

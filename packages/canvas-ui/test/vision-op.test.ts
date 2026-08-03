/**
 * 单元:Canvas 解读载荷构造器 `buildVisionOp`(spec canvas-vision-readout,Req 1.3 / 3.3 / 3.4)。
 *
 * 三条回归锁:
 *  ① **围栏隐性契约**:tool 行必须内嵌中文指令,fence 恒 `canvas-op`。
 *     agent 的 systemPrompt 没教 LLM 解析该围栏,理解全靠这行指令。
 *  ② **空 model 不产生参数行** —— 否则工具收到空 model 会报 `unknown_model`,而不是弹层。
 *  ③ **参数顺序 image → question → model** —— 渲染输出确定性。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderSurfaceOp } from "@blksails/pi-web-kit";
import {
  buildVisionOp,
  fetchVisionModels,
  __setVisionModelCatalogFetchImpl,
  __resetVisionModelCatalogCache,
  __setVisionModelCatalogNowFn,
  VISION_MODEL_CATALOG_CACHE_TTL_MS,
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

// ── fetchVisionModels(multi-gateway-providers 任务 6.3;Req 9.2, 11.1, 11.2, 11.6)───
// reviewer 首轮指出:useVisionModels 的 fetch 分支**零测试覆盖**。抽成纯函数后逐条锁死。
// 不变式:**任何失败都折成空数组,绝不抛出** —— 否则解读按钮会被拖垮。
//
// 任务 6.3 变更:改打唯一部署级目录端点 `/config/models?input=image&output=text`(取代已
// 删除的 `/vision/models`);查询串必须同时约束 output=text,否则会纳入 output 为 image
// 的 AIGC 图生图/改图模型(六批完整性批评 gap 4)。响应条目为 `{provider,id,name}`,复合
// 标识 `${provider}/${id}` 由本函数拼装;取数按 baseUrl 分桶模块级缓存,与设置页
// VisionModelSelectField 共用。

function okRes(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe("fetchVisionModels — 取数与缓存(multi-gateway-providers 任务 6.3)", () => {
  beforeEach(() => {
    __resetVisionModelCatalogCache();
  });
  afterEach(() => {
    __resetVisionModelCatalogCache();
    vi.restoreAllMocks();
  });

  it("2xx + 合法 models → 拼装 `${provider}/${id}` 复合标识,name 映射为 label(Req 11.6)", async () => {
    __setVisionModelCatalogFetchImpl(async () =>
      okRes({ models: [{ provider: "p", id: "m", name: "M" }] }),
    );
    const got = await fetchVisionModels("/api");
    expect(got).toEqual([{ value: "p/m", label: "M", provider: "p" }]);
  });

  it("过滤掉形状不合法的项(缺 provider / id / name)", async () => {
    __setVisionModelCatalogFetchImpl(async () =>
      okRes({
        models: [
          { provider: "p", id: "m", name: "M" },
          { provider: "p", id: "m2" },
          null,
          {},
        ],
      }),
    );
    const got = await fetchVisionModels("/api");
    expect(got).toEqual([{ value: "p/m", label: "M", provider: "p" }]);
  });

  it("请求路径为 `${baseUrl}/config/models?input=image&output=text`(唯一部署级目录端点,取代已删除的 /vision/models,且必须约束 output=text 以排除 AIGC 图生图模型)", async () => {
    const spy = vi.fn(async () => okRes({ models: [] }));
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
    await fetchVisionModels("/api");
    expect(spy).toHaveBeenCalledWith("/api/config/models?input=image&output=text");
  });

  it("★ 同一 baseUrl 的重复调用共用同一次取数(Req 11.1/11.2:两处消费面共用同一次取数与缓存)", async () => {
    const spy = vi.fn(async () => okRes({ models: [{ provider: "p", id: "m", name: "M" }] }));
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
    const [a, b, c] = await Promise.all([
      fetchVisionModels("/api"),
      fetchVisionModels("/api"),
      fetchVisionModels("/api"),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("不同 baseUrl 各自独立取数(缓存按 baseUrl 分桶)", async () => {
    const spy = vi.fn(async () => okRes({ models: [] }));
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
    await fetchVisionModels("/api");
    await fetchVisionModels("/other");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("★ fetchVisionModels — 一切失败都折成空数组,绝不抛出,但留可辨识错误", () => {
  beforeEach(() => {
    __resetVisionModelCatalogCache();
  });
  afterEach(() => {
    __resetVisionModelCatalogCache();
    vi.restoreAllMocks();
  });

  it("baseUrl 缺省 / 空串 → [] 且不发请求", async () => {
    const spy = vi.fn();
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
    for (const base of [undefined, ""]) {
      await expect(fetchVisionModels(base)).resolves.toEqual([]);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("★ pane 哨兵 baseUrl(`pane://host`)→ [] 且既不发请求、也不报错", async () => {
    // pane 车道传的是「拿不到宿主 baseUrl」的哨兵而非真 URL(canvas.tsx:239),视觉模型选择
    // 在 pane 里已下沉到 agent。若不短路,每次打开 Canvas pane 都会对一个按设计不可达的 URL
    // 报一次 console.error —— 常态路径变常态报错,真正的破坏信号被淹没。
    const spy = vi.fn();
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fetchVisionModels("pane://host")).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("相对路径与绝对 http(s) 仍照常取数(短路规则不误伤真实端点)", async () => {
    for (const base of ["/api", "http://localhost:3000/api", "https://x.example/api"]) {
      __resetVisionModelCatalogCache();
      const spy = vi.fn(async () => okRes({ models: [] }));
      __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);
      await fetchVisionModels(base);
      expect(spy, `${base} 应发请求`).toHaveBeenCalledTimes(1);
    }
  });

  it("非 2xx → [],留一行可辨识的 console.error(带端点路径)", async () => {
    __setVisionModelCatalogFetchImpl(async () => ({ ok: false, status: 500 }) as Response);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const got = await fetchVisionModels("/api");
    expect(got).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(
      "/api/config/models?input=image&output=text",
    );
  });

  it("网络错误(fetch 抛) → [],不外泄异常", async () => {
    __setVisionModelCatalogFetchImpl(async () => {
      throw new Error("network down");
    });
    await expect(fetchVisionModels("/api")).resolves.toEqual([]);
  });

  it("响应体非法 JSON(json() 抛) → []", async () => {
    __setVisionModelCatalogFetchImpl(
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new SyntaxError("bad json");
          },
        }) as unknown as Response,
    );
    const got = await fetchVisionModels("/api");
    expect(got).toEqual([]);
  });

  it("models 不是数组 → []", async () => {
    __setVisionModelCatalogFetchImpl(async () => okRes({ models: "nope" }));
    expect(await fetchVisionModels("/api")).toEqual([]);
    __resetVisionModelCatalogCache();
    __setVisionModelCatalogFetchImpl(async () => okRes({}));
    expect(await fetchVisionModels("/api")).toEqual([]);
  });
});

describe("fetchVisionModels — 缓存 TTL 失效(multi-gateway-providers 任务 6.6,Req 11.3/11.4/11.5)", () => {
  beforeEach(() => {
    __resetVisionModelCatalogCache();
  });
  afterEach(() => {
    __resetVisionModelCatalogCache();
    __setVisionModelCatalogNowFn(() => Date.now()); // 复位为默认时钟,避免污染其它用例
    vi.restoreAllMocks();
  });

  it("TTL 内:同一 baseUrl 的后续调用仍命中缓存(不重复请求)", async () => {
    let clock = 1_000_000;
    __setVisionModelCatalogNowFn(() => clock);
    const spy = vi.fn(async () => okRes({ models: [{ provider: "p", id: "m", name: "M" }] }));
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);

    await fetchVisionModels("/api");
    clock += VISION_MODEL_CATALOG_CACHE_TTL_MS - 1; // 差 1ms 未到期
    await fetchVisionModels("/api");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("★ TTL 过期后:同一 baseUrl 的下一次调用重新取数,拿到新增 provider(不必整页刷新)", async () => {
    let clock = 1_000_000;
    __setVisionModelCatalogNowFn(() => clock);
    const before = { models: [{ provider: "existing", id: "m1", name: "M1" }] };
    const after = {
      models: [
        { provider: "existing", id: "m1", name: "M1" },
        { provider: "brand-new", id: "m2", name: "M2" },
      ],
    };
    const spy = vi.fn(async () =>
      okRes(clock < 1_000_000 + VISION_MODEL_CATALOG_CACHE_TTL_MS ? before : after),
    );
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);

    const first = await fetchVisionModels("/api");
    expect(first).toEqual([{ value: "existing/m1", label: "M1", provider: "existing" }]);

    clock += VISION_MODEL_CATALOG_CACHE_TTL_MS + 1;
    const second = await fetchVisionModels("/api");

    expect(second).toEqual([
      { value: "existing/m1", label: "M1", provider: "existing" },
      { value: "brand-new/m2", label: "M2", provider: "brand-new" },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("★ TTL 未过期(时钟不推进),但收到 pi-web:config-saved 事件 → 下一次调用立即刷新(任务 6.6 主机制;修复前只有 TTL 时本用例必须报红)", async () => {
    const clock = 1_000_000; // 恒定不推进——仅靠事件驱动失效,不能靠 TTL 兜底救场。
    __setVisionModelCatalogNowFn(() => clock);
    const before = { models: [{ provider: "existing", id: "m1", name: "M1" }] };
    const after = {
      models: [
        { provider: "existing", id: "m1", name: "M1" },
        { provider: "brand-new", id: "m2", name: "M2" },
      ],
    };
    let saved = false;
    const spy = vi.fn(async () => okRes(saved ? after : before));
    __setVisionModelCatalogFetchImpl(spy as unknown as typeof fetch);

    const first = await fetchVisionModels("/api");
    expect(first).toEqual([{ value: "existing/m1", label: "M1", provider: "existing" }]);

    // 保存成功后 useConfigDomain 会广播该事件;这里直接模拟广播,不经 React 组件。
    saved = true;
    globalThis.dispatchEvent(
      new CustomEvent("pi-web:config-saved", { detail: { domain: "settings" } }),
    );
    const second = await fetchVisionModels("/api");

    expect(second).toEqual([
      { value: "existing/m1", label: "M1", provider: "existing" },
      { value: "brand-new/m2", label: "M2", provider: "brand-new" },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

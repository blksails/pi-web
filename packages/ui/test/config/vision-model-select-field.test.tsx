/**
 * VisionModelSelectField 组件测试(multi-gateway-providers 任务 6.3;Req 9.2, 11.1, 11.2, 11.6)。
 *
 * 覆盖:清单来自唯一部署级目录端点 `/api/config/models?input=image&output=text`(取代已
 * 删除的 `/api/vision/models`;output=text 必不可少,否则会纳入 output 为 image 的 AIGC
 * 图生图/改图模型,六批完整性批评 gap 4)、复合标识 `${provider}/${id}` 拼装、存量偏好值
 * (裸复合键)仍能命中清单、与解读弹层(`vision-op.ts`)共用同一次取数(★核心验收点)、
 * 取数失败回退占位且不再静默(留一行可辨识的 console.error)。fetch 经
 * `__setVisionModelsFetchImpl`(转发自 `@blksails/pi-web-canvas-ui` 的共享缓存函数)注入。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  VisionModelSelectField,
  __setVisionModelsFetchImpl,
  __resetVisionModelsCache,
} from "../../src/config/fields/vision-model-select-field.js";
// 直接从 canvas-ui 拿 fetchVisionModels——代表「另一处消费面」(解读弹层 vision-op.ts 的
// useVisionModels 调用的正是这个函数),用来断言两处共用同一次取数(任务 6.3 核心验收点)。
import { fetchVisionModels } from "@blksails/pi-web-canvas-ui";

const descriptor: FieldDescriptor = {
  key: "visionModel",
  kind: "string",
  label: "视觉模型",
  required: false,
  widget: "visionModelSelect",
};

const CATALOG = {
  models: [
    { provider: "openrouter", id: "gpt-5.4-vision", name: "GPT-5.4 Vision · OpenRouter" },
    { provider: "dashscope", id: "qwen-vl-max", name: "Qwen VL Max" },
  ],
};

function mockFetch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    // 断言取数命中统一部署级目录端点(带 input=image&output=text 筛选,multi-gateway-
    // providers 任务 4.3/6.3):不再打已删除的独立 /api/vision/models;output=text 不可省,
    // 否则会纳入 output 为 image 的 AIGC 图生图/改图模型(六批完整性批评 gap 4)。
    expect(String(input)).toBe("/api/config/models?input=image&output=text");
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    };
  });
  __setVisionModelsFetchImpl(spy as unknown as typeof fetch);
  return spy;
}

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props = { descriptor, value, onChange, path: ["visionModel"], errors: {} };
  render(<VisionModelSelectField {...props} />);
  return onChange;
}

describe("VisionModelSelectField", () => {
  beforeEach(() => {
    __resetVisionModelsCache();
  });
  afterEach(() => {
    cleanup();
    __resetVisionModelsCache();
    vi.restoreAllMocks();
  });

  it("清单来自 /api/config/models?input=image&output=text,复合标识 = provider/id,label 用 name(Req 11.6)", async () => {
    mockFetch(CATALOG);
    renderField("");
    const opt = await waitFor(() => {
      const el = document.querySelector('[data-vision-model-option="openrouter/gpt-5.4-vision"]');
      if (el === null) throw new Error("not yet");
      return el;
    });
    expect(opt).not.toBeNull();
    expect(document.body.textContent).toContain("GPT-5.4 Vision");
    expect(
      document.querySelector('[data-vision-model-option="dashscope/qwen-vl-max"]'),
    ).not.toBeNull();
  });

  it("选中某项 → onChange 收到复合标识 provider/id", async () => {
    mockFetch(CATALOG);
    const onChange = renderField("");
    const opt = await waitFor(() => {
      const el = document.querySelector('[data-vision-model-option="dashscope/qwen-vl-max"]');
      if (el === null) throw new Error("not yet");
      return el;
    });
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith("dashscope/qwen-vl-max");
  });

  it("存量偏好值(裸复合键)命中清单 → 无 orphan 标记(Req 11.6:零迁移)", async () => {
    mockFetch(CATALOG);
    renderField("dashscope/qwen-vl-max");
    await waitFor(() => {
      expect(document.querySelector('[data-vision-model-count]')).not.toBeNull();
    });
    expect(document.querySelector('[data-pi-model-orphan="true"]')).toBeNull();
    expect(
      document.querySelector('[data-vision-model-current="dashscope/qwen-vl-max"]'),
    ).not.toBeNull();
  });

  it("存量偏好值不在清单里 → 标记为可辨识的 orphan(data-pi-model-orphan,任务 7.2,Req 6.5/9.4),不静默丢弃且值仍原样保留", async () => {
    mockFetch(CATALOG);
    renderField("removed-provider/removed-model");
    await waitFor(() => {
      expect(document.querySelector('[data-pi-model-orphan="true"]')).not.toBeNull();
    });
    // 与设置页 provider/模型下拉(model-select-field.tsx)及会话模型选择器
    // (elements/model-selector.tsx)共用同一套标记语义,不各造一套。
    expect(
      document.querySelector('[data-vision-model-current="removed-provider/removed-model"]'),
    ).not.toBeNull();
  });

  it("取数失败 → 回退占位,不崩,且在控制台留一行可辨识错误(不再静默,任务 6.3 核心验收点)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch({}, false);
    renderField("");
    await waitFor(() =>
      expect(document.body.textContent).toContain("没有凭据可用且支持图像输入的模型"),
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message] = consoleError.mock.calls[0] ?? [];
    expect(String(message)).toContain("/api/config/models?input=image&output=text");
  });

  it("★ 与另一处消费面(解读弹层的 fetchVisionModels)共用同一次取数与缓存(Req 11.1/11.2)", async () => {
    const spy = mockFetch(CATALOG);
    // 模拟解读弹层先取一次(同一 baseUrl "/api")。
    const fromOtherConsumer = await fetchVisionModels("/api");
    expect(spy).toHaveBeenCalledTimes(1);

    // 设置界面字段随后渲染:命中共享缓存,不应再发第二次请求。
    renderField("");
    await waitFor(() => {
      expect(document.querySelector('[data-vision-model-count]')).not.toBeNull();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // 两处消费面拿到的是同一份数据。
    expect(fromOtherConsumer).toEqual([
      { value: "openrouter/gpt-5.4-vision", label: "GPT-5.4 Vision · OpenRouter", provider: "openrouter" },
      { value: "dashscope/qwen-vl-max", label: "Qwen VL Max", provider: "dashscope" },
    ]);
  });
});

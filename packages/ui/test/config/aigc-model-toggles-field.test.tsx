/**
 * AigcModelTogglesField 组件测试(aigc-tool-settings)。
 *
 * 覆盖:清单来自注入的 /api/aigc/models、勾选态 = 未被禁、切换更新 disabledModels 数组、
 * label + provider 徽章渲染、取数失败回退占位。fetch 经 __setAigcModelsFetchImpl 注入。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  AigcModelTogglesField,
  __setAigcModelsFetchImpl,
  __resetAigcModelsCache,
} from "../../src/config/fields/aigc-model-toggles-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "disabledModels",
  kind: "stringList",
  label: "启用的图像模型",
  required: false,
  widget: "aigcModelToggles",
};

const CATALOG = {
  models: [
    { model: "gpt-image-2", label: "GPT Image 2 · NewAPI", provider: "newapi" },
    { model: "wan2.7-image-pro", label: "Wan 2.7 Image Pro", provider: "dashscope" },
  ],
};

function mockFetch(body: unknown, ok = true): void {
  __setAigcModelsFetchImpl(
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor, value, onChange, path: ["disabledModels"], errors: {} };
  render(<AigcModelTogglesField {...props} />);
  return onChange;
}

describe("AigcModelTogglesField", () => {
  beforeEach(() => {
    __resetAigcModelsCache();
    mockFetch(CATALOG);
  });
  afterEach(() => {
    cleanup();
    __resetAigcModelsCache();
    vi.restoreAllMocks();
  });

  it("清单来自 /api/aigc/models,被禁项未勾选、其余勾选", async () => {
    renderField(["gpt-image-2"]);
    const disabled = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-aigc-model-toggle="gpt-image-2"]',
      );
      if (el === null) throw new Error("not yet");
      return el;
    });
    expect(disabled.checked).toBe(false); // 被禁 → 未勾选
    const enabled = document.querySelector<HTMLInputElement>(
      '[data-aigc-model-toggle="wan2.7-image-pro"]',
    );
    expect(enabled?.checked).toBe(true);
    // provider 徽章 + 去后缀显示名
    expect(document.body.textContent).toContain("GPT Image 2");
    expect(document.body.textContent).not.toContain("· NewAPI");
  });

  it("取消勾选某模型 → onChange 加入 disabledModels 数组", async () => {
    const onChange = renderField([]);
    const box = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-aigc-model-toggle="wan2.7-image-pro"]',
      );
      if (el === null) throw new Error("not yet");
      return el;
    });
    fireEvent.click(box); // 取消勾选 → 禁用
    expect(onChange).toHaveBeenCalledWith(["wan2.7-image-pro"]);
  });

  it("重新勾选已禁用模型 → onChange 从数组移除", async () => {
    const onChange = renderField(["gpt-image-2"]);
    const box = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-aigc-model-toggle="gpt-image-2"]',
      );
      if (el === null) throw new Error("not yet");
      return el;
    });
    fireEvent.click(box); // 勾选 → 启用 → 从 disabled 移除
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("取数失败 → 回退占位,不崩", async () => {
    __resetAigcModelsCache();
    mockFetch({}, false);
    renderField([]);
    await waitFor(() =>
      expect(document.body.textContent).toContain("模型清单加载中"),
    );
  });
});

/**
 * ModelSelectField 组件测试(ai-gateway-providers spec 任务 4.2 + model-catalog spec 任务 4.1)。
 *
 * 覆盖:选项来自注入的 /api/config/models、modelSelect 组按 provider 分组、
 * 带 `source` 字段的条目渲染来源徽章(ai-gateway/self)、不带 `source` 字段的条目
 * 不渲染徽章(未启用 ai-gateway 套件时与今天一致);model-catalog 任务 4.1:
 * providerSelect 选项集恒等于响应 providers 数组(3.1)、availability="catalog" 条目
 * 不可选中且不可提交并附提示文案(3.2)、存量无效值原样显示不崩溃(3.3)。
 * fetch 经 __setModelOptionsFetchImpl 注入,取数经模块级 Promise 缓存,
 * __resetModelOptionsCache 复位。
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, screen } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  ModelSelectField,
  __setModelOptionsFetchImpl,
  __resetModelOptionsCache,
} from "../../src/config/fields/model-select-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "defaultModel",
  kind: "string",
  label: "默认模型",
  required: false,
  widget: "modelSelect",
};

function mockFetch(body: unknown, ok = true): void {
  __setModelOptionsFetchImpl(
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor, value, onChange, path: ["defaultModel"], errors: {} };
  render(<ModelSelectField {...props} />);
  return onChange;
}

describe("ModelSelectField — 来源徽章(Req 4.2)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("条目带 source='ai-gateway' → 渲染网关徽章", async () => {
    mockFetch({
      providers: ["anthropic", "openrouter"],
      models: [
        { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet", source: "ai-gateway" },
        { provider: "openrouter", id: "self-model", name: "Self Model", source: "self" },
      ],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
    });
    const gatewayBadge = document.querySelector('[data-pi-model-source="ai-gateway"]');
    const selfBadge = document.querySelector('[data-pi-model-source="self"]');
    expect(gatewayBadge).not.toBeNull();
    expect(selfBadge).not.toBeNull();
  });

  it("条目不带 source(未启用 ai-gateway 套件)→ 不渲染任何来源徽章", async () => {
    mockFetch({
      providers: ["openrouter"],
      models: [{ provider: "openrouter", id: "plain-model", name: "Plain Model" }],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("plain-model")).toBeInTheDocument();
    });
    expect(document.querySelector("[data-pi-model-source]")).toBeNull();
  });
});

describe("ModelSelectField — 目录态与 provider 收敛(model-catalog 任务 4.1)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("providerSelect:选项集恒等于响应 providers 数组(models 内 ai-gateway 分组不出现)(3.1)", async () => {
    mockFetch({
      providers: ["apiservices", "dashscope"],
      models: [
        { provider: "apiservices", id: "m1", name: "M1" },
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    const providerDescriptor: FieldDescriptor = {
      key: "defaultProvider",
      kind: "string",
      label: "默认 Provider",
      required: false,
      widget: "providerSelect",
    };
    const props: FieldProps = {
      descriptor: providerDescriptor,
      value: "",
      onChange: vi.fn(),
      path: ["defaultProvider"],
      errors: {},
    };
    render(<ModelSelectField {...props} />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("apiservices")).toBeInTheDocument();
    });
    const labels = screen
      .getAllByRole("option")
      .map((el) => el.textContent?.trim());
    expect(labels).toEqual(["apiservices", "dashscope"]);
  });

  it("modelSelect:availability='catalog' 条目 disabled、点击不提交、附「未接入会话」提示(3.2)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    const onChange = renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("gw-model")).toBeInTheDocument();
    });
    const item = screen.getByText("gw-model").closest('[role="option"]');
    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    // 提示文案(默认 locale zh)
    expect(screen.getByText("未接入会话")).toBeInTheDocument();
  });

  it("modelSelect:availability 缺省(session)条目可正常选中(回归)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        { provider: "apiservices", id: "m1", name: "M1" },
        { provider: "apiservices", id: "m2", name: "M2", availability: "session" },
      ],
    });
    const onChange = renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    const m1 = screen.getByText("m1").closest('[role="option"]');
    expect(m1).toHaveAttribute("aria-disabled", "false");
    const m2 = screen.getByText("m2").closest('[role="option"]');
    expect(m2).toHaveAttribute("aria-disabled", "false");
    // 可选条目不渲染目录态提示
    expect(screen.queryByText("未接入会话")).toBeNull();
    // 点击可选条目 → 正常提交(commit 会关闭面板,故放最后)
    fireEvent.click(m1 as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("m1");
  });

  it("存量无效值:value 不在选项中 → 触发器原样显示且不崩溃(3.3)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [{ provider: "apiservices", id: "m1", name: "M1" }],
    });
    renderField("legacy-ghost-model");
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("legacy-ghost-model");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    // 打开面板后触发器仍原样显示存量值
    expect(trigger).toHaveTextContent("legacy-ghost-model");
  });

  it("徽章回归:source='ai-gateway' 的目录态条目仍渲染来源徽章(2.4)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("gw-model")).toBeInTheDocument();
    });
    expect(document.querySelector('[data-pi-model-source="ai-gateway"]')).not.toBeNull();
  });
});

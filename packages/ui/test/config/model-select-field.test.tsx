/**
 * ModelSelectField 组件测试(ai-gateway-providers spec,任务 4.2)。
 *
 * 覆盖:选项来自注入的 /api/config/models、modelSelect 组按 provider 分组、
 * 带 `source` 字段的条目渲染来源徽章(ai-gateway/self)、不带 `source` 字段的条目
 * 不渲染徽章(未启用 ai-gateway 套件时与今天一致)。fetch 经
 * __setModelOptionsFetchImpl 注入,取数经模块级 Promise 缓存,__resetModelOptionsCache 复位。
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

/**
 * NamespaceTogglesField（任务 3.4）：命名空间开关字段测试。
 *
 * 覆盖 requirements:
 *  - Req 6.7 — 渲染开关列表；切换复选框调用 onChange 更新 Record<string,boolean>
 *  - Req 6.7 — 添加新命名空间条目
 *  - Req 6.7 — 删除条目
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { NamespaceTogglesField } from "../../src/config/fields/namespace-toggles-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "namespaces",
  kind: "record",
  label: "命名空间",
  required: false,
  widget: "logNamespaceToggles",
};

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = {
    descriptor,
    value,
    onChange,
    path: ["namespaces"],
    errors: {},
  };
  render(<NamespaceTogglesField {...props} />);
  return onChange;
}

describe("NamespaceTogglesField", () => {
  it("空值时渲染占位", () => {
    renderField(undefined);
    expect(screen.getByText(/暂无命名空间/)).toBeInTheDocument();
  });

  it("渲染已有命名空间并展示复选框", () => {
    renderField({ "agent:tool": true, "agent:http": false });
    // Find the specific toggles by data attribute
    const allCheckboxes = document.querySelectorAll("[data-pi-ns-toggle]");
    expect(allCheckboxes).toHaveLength(2);
    expect(document.querySelector("[data-pi-ns-toggle='agent:tool']")).not.toBeNull();
    expect(document.querySelector("[data-pi-ns-toggle='agent:http']")).not.toBeNull();
    // `agent:tool` is checked, `agent:http` is unchecked.
    expect((document.querySelector("[data-pi-ns-toggle='agent:tool']") as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector("[data-pi-ns-toggle='agent:http']") as HTMLInputElement).checked).toBe(false);
  });

  it("切换复选框调用 onChange 更新 record（Req 6.7）", async () => {
    const user = userEvent.setup();
    const onChange = renderField({ "agent:tool": true });
    const checkbox = document.querySelector("[data-pi-ns-toggle='agent:tool']") as HTMLInputElement;
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ "agent:tool": false });
  });

  it("添加新命名空间条目（Req 6.7）", async () => {
    const user = userEvent.setup();
    const onChange = renderField({});
    await user.type(screen.getByPlaceholderText(/添加命名空间/), "agent:new");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(onChange).toHaveBeenCalledWith({ "agent:new": true });
  });

  it("按 Enter 添加新命名空间", async () => {
    const user = userEvent.setup();
    const onChange = renderField({});
    const input = screen.getByPlaceholderText(/添加命名空间/);
    await user.type(input, "my:ns{Enter}");
    expect(onChange).toHaveBeenCalledWith({ "my:ns": true });
  });

  it("删除条目触发 onChange（Req 6.7）", async () => {
    const user = userEvent.setup();
    const onChange = renderField({ "agent:tool": true });
    const deleteBtn = screen.getByRole("button", { name: "删" });
    await user.click(deleteBtn);
    expect(onChange).toHaveBeenCalledWith({});
  });
});

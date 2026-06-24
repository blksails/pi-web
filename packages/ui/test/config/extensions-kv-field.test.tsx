import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { FieldDescriptor } from "@blksails/protocol";
import { ExtensionsKvField } from "../../src/config/fields/extensions-kv-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "extensions",
  kind: "record",
  label: "扩展",
  required: false,
  widget: "extensionsKv",
};

type ExtEntry = { enabled: boolean; spec?: string; params: Record<string, string> };

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = {
    descriptor,
    value,
    onChange,
    path: ["extensions"],
    errors: {},
  };
  render(<ExtensionsKvField {...props} />);
  return onChange;
}

describe("ExtensionsKvField", () => {
  it("空值渲染占位,添加扩展条目(手动 KV:enabled+空 params)触发 onChange", async () => {
    const user = userEvent.setup();
    const onChange = renderField(undefined);
    expect(screen.getByText("暂无扩展条目")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/新增扩展条目/), "@a/b");
    await user.click(screen.getByRole("button", { name: "添加扩展条目" }));
    expect(onChange).toHaveBeenCalledWith({ "@a/b": { enabled: true, params: {} } });
  });

  it("渲染已有条目并可编辑键值(受控)", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    function Harness(): React.JSX.Element {
      const [v, setV] = React.useState<Record<string, ExtEntry>>({
        "@a/b": { enabled: true, params: { HTTP_PROXY: "old" } },
      });
      return (
        <ExtensionsKvField
          descriptor={descriptor}
          value={v}
          onChange={(next: unknown) => {
            seen.push(next);
            setV(next as Record<string, ExtEntry>);
          }}
          path={["extensions"]}
          errors={{}}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText("@a/b")).toBeInTheDocument();
    const valueInput = screen.getByDisplayValue("old");
    await user.clear(valueInput);
    await user.type(valueInput, "x");
    expect(seen[seen.length - 1]).toEqual({
      "@a/b": { enabled: true, params: { HTTP_PROXY: "x" } },
    });
  });

  it("package 条目(带 spec)显示启用开关,切换 → enabled 翻转(可禁用,保留 spec)", async () => {
    const user = userEvent.setup();
    const onChange = renderField({
      "pi-sandbox": { enabled: true, spec: "npm:pi-sandbox", params: {} },
    });
    expect(screen.getByText("已启用")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith({
      "pi-sandbox": { enabled: false, spec: "npm:pi-sandbox", params: {} },
    });
  });

  it("手动 KV 条目(无 spec)不显示启用开关", () => {
    renderField({ "@a/b": { enabled: true, params: { K: "v" } } });
    expect(screen.queryByText("已启用")).not.toBeInTheDocument();
    expect(screen.queryByText("已禁用")).not.toBeInTheDocument();
  });

  it("添加键值行 + 删除扩展条目", async () => {
    const user = userEvent.setup();
    const onChange = renderField({ "@a/b": { enabled: true, params: {} } });
    await user.click(screen.getByRole("button", { name: "+ 键值" }));
    expect(onChange).toHaveBeenLastCalledWith({
      "@a/b": { enabled: true, params: { "": "" } },
    });
    onChange.mockClear();
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

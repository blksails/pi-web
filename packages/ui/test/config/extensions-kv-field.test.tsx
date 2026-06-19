import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { FieldDescriptor } from "@pi-web/protocol";
import { ExtensionsKvField } from "../../src/config/fields/extensions-kv-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "extensions",
  kind: "record",
  label: "扩展参数",
  required: false,
  widget: "extensionsKv",
};

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
  it("空值渲染占位,添加扩展条目触发 onChange", async () => {
    const user = userEvent.setup();
    const onChange = renderField(undefined);
    expect(screen.getByText("暂无扩展条目")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/新增扩展条目/), "@a/b");
    await user.click(screen.getByRole("button", { name: "添加扩展条目" }));
    expect(onChange).toHaveBeenCalledWith({ "@a/b": {} });
  });

  it("渲染已有条目并可编辑键值(受控)", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    function Harness(): React.JSX.Element {
      const [v, setV] = React.useState<Record<string, Record<string, string>>>({
        "@a/b": { HTTP_PROXY: "old" },
      });
      return (
        <ExtensionsKvField
          descriptor={descriptor}
          value={v}
          onChange={(next: unknown) => {
            seen.push(next);
            setV(next as Record<string, Record<string, string>>);
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
    expect(seen[seen.length - 1]).toEqual({ "@a/b": { HTTP_PROXY: "x" } });
  });

  it("添加键值行 + 删除扩展条目", async () => {
    const user = userEvent.setup();
    const onChange = renderField({ "@a/b": {} });
    await user.click(screen.getByRole("button", { name: "+ 键值" }));
    expect(onChange).toHaveBeenLastCalledWith({ "@a/b": { "": "" } });
    onChange.mockClear();
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

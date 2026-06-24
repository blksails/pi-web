import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { ObjectListField } from "../../src/config/fields/object-list-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const variantDescriptor: FieldDescriptor = {
  key: "profileConfig",
  kind: "objectList",
  label: "Profiles",
  required: false,
  variants: {
    discriminator: "type",
    cases: [
      { value: "proxy_server", label: "Proxy", fields: [{ key: "server", kind: "string", label: "Server", required: true }] },
      { value: "autoSwitch", label: "Auto", fields: [{ key: "name", kind: "string", label: "Name", required: true }] },
    ],
  },
};

function renderField(d: FieldDescriptor, value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor: d, value, onChange, path: [d.key], errors: {} };
  render(<ObjectListField {...props} />);
  return onChange;
}

describe("ObjectListField", () => {
  it("空值占位 + 添加项(variants → 默认首个变体)", async () => {
    const user = userEvent.setup();
    const onChange = renderField(variantDescriptor, undefined);
    expect(screen.getByText("暂无条目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加条目" }));
    expect(onChange).toHaveBeenCalledWith([{ type: "proxy_server" }]);
  });

  it("variants:渲染判别选择器 + 该变体字段;切换判别重置项", () => {
    const onChange = renderField(variantDescriptor, [{ type: "proxy_server", server: "s1" }]);
    // proxy_server 变体显示 Server 字段。
    expect(screen.getByText("Server")).toBeInTheDocument();
    expect(screen.getByDisplayValue("s1")).toBeInTheDocument();
    // 切换到 autoSwitch → 重置该项为 {type:"autoSwitch"}。
    const sel = screen.getByRole("combobox");
    fireEvent.change(sel, { target: { value: "autoSwitch" } });
    expect(onChange).toHaveBeenLastCalledWith([{ type: "autoSwitch" }]);
  });

  it("编辑子字段回写到对应数组项", async () => {
    const user = userEvent.setup();
    const onChange = renderField(variantDescriptor, [{ type: "proxy_server", server: "" }]);
    await user.type(screen.getByRole("textbox"), "x");
    expect(onChange).toHaveBeenLastCalledWith([{ type: "proxy_server", server: "x" }]);
  });

  it("itemFields(无 variants):按字段渲染,删除项", async () => {
    const user = userEvent.setup();
    const d: FieldDescriptor = {
      key: "rules",
      kind: "objectList",
      label: "Rules",
      required: false,
      itemFields: [{ key: "note", kind: "string", label: "Note", required: false }],
    };
    const onChange = renderField(d, [{ note: "n1" }]);
    expect(screen.getByDisplayValue("n1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

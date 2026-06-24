/**
 * field-default-echo.test.tsx — TDD: 字段默认回显 + null 显示修复
 *
 * RED 测试：
 * 1. number 字段 value=null/undefined → 渲染空输入框，不含文本 "null"
 * 2. boolean 字段 value=undefined + descriptor.default=true → 渲染为勾选
 * 3. enum 字段 value=undefined + descriptor.default="info" → 渲染选中 "info"
 * 4. 嵌套 object 子字段 default 回显（outputs.console default:true）
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FieldDescriptor } from "@pi-web/protocol";
import { FieldRenderer } from "../../src/config/field-renderer.js";

const baseProps = {
  onChange: () => undefined,
  path: [] as readonly string[],
  errors: {} as Record<string, string>,
};

function desc(over: Partial<FieldDescriptor>): FieldDescriptor {
  return { key: "k", kind: "string", label: "Test", required: false, ...over };
}

// ─── 1. NumberField: null/undefined → 空输入框，不显示 "null" ───────────────

describe("NumberField — null/undefined 显示", () => {
  it("value=null 渲染空输入框，不含文本 'null'", () => {
    const d = desc({ kind: "number", label: "Max Size MB" });
    render(<FieldRenderer descriptor={d} value={null} {...baseProps} />);
    // 应有 input 元素，值为空
    const input = screen.getByRole("spinbutton");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("");
    // 不应在文档中显示字面 "null"
    expect(screen.queryByText("null")).toBeNull();
  });

  it("value=undefined 渲染空输入框，不含文本 'null'", () => {
    const d = desc({ kind: "number", label: "Max Files" });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    const input = screen.getByRole("spinbutton");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("null")).toBeNull();
  });

  it("value=42 正常显示数字", () => {
    const d = desc({ kind: "number", label: "Max Size MB" });
    render(<FieldRenderer descriptor={d} value={42} {...baseProps} />);
    const input = screen.getByRole("spinbutton");
    expect((input as HTMLInputElement).value).toBe("42");
  });
});

// ─── 2. BooleanField: value=undefined + descriptor.default=true → 勾选 ──────

describe("BooleanField — 默认回显", () => {
  it("value=undefined + default=true → 渲染为勾选", () => {
    const d = desc({ kind: "boolean", label: "Enabled", default: true });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("value=undefined + default=false → 渲染为未勾选", () => {
    const d = desc({ kind: "boolean", label: "Enabled", default: false });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("value=undefined + 无 default → 渲染为未勾选（维持现状）", () => {
    const d = desc({ kind: "boolean", label: "Enabled" });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("value=false 显式覆盖 default=true → 渲染为未勾选", () => {
    const d = desc({ kind: "boolean", label: "Enabled", default: true });
    render(<FieldRenderer descriptor={d} value={false} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});

// ─── 3. EnumField: value=undefined + descriptor.default="info" → 选中 ───────

describe("EnumField — 默认回显", () => {
  const options = [
    { value: "debug", label: "Debug" },
    { value: "info", label: "Info" },
    { value: "warn", label: "Warn" },
    { value: "error", label: "Error" },
  ];

  it("value=undefined + default='info' → 渲染选中 'info'", () => {
    const d = desc({
      kind: "enum",
      label: "Level",
      enumOptions: options,
      default: "info",
    });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    // Select 控件应显示 "Info"
    expect(screen.getByText("Info")).toBeInTheDocument();
    // 占位符不应可见
    expect(screen.queryByText("请选择…")).toBeNull();
  });

  it("value=undefined + 无 default → 显示占位符（维持现状）", () => {
    const d = desc({
      kind: "enum",
      label: "Level",
      enumOptions: options,
    });
    render(<FieldRenderer descriptor={d} value={undefined} {...baseProps} />);
    expect(screen.getByText("请选择…")).toBeInTheDocument();
  });

  it("value='warn' 显式覆盖 default='info' → 渲染选中 'warn'", () => {
    const d = desc({
      kind: "enum",
      label: "Level",
      enumOptions: options,
      default: "info",
    });
    render(<FieldRenderer descriptor={d} value="warn" {...baseProps} />);
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.queryByText("Info")).toBeNull();
  });
});

// ─── 4. ObjectField 嵌套子字段 default 回显 ──────────────────────────────────

describe("ObjectField — 嵌套子字段默认回显", () => {
  it("outputs.console default=true 时，value={} 下子字段回显勾选", () => {
    // 模拟 outputs object 字段，含 console boolean 子字段 default=true
    const d = desc({
      kind: "object",
      label: "Outputs",
      fields: [
        {
          key: "console",
          kind: "boolean",
          label: "Console",
          required: false,
          default: true,
        },
      ],
    });
    // value={} → console 子字段值为 undefined → 应回显 default=true
    render(<FieldRenderer descriptor={d} value={{}} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("子字段有显式值时不受 default 影响", () => {
    const d = desc({
      kind: "object",
      label: "Outputs",
      fields: [
        {
          key: "console",
          kind: "boolean",
          label: "Console",
          required: false,
          default: true,
        },
      ],
    });
    render(
      <FieldRenderer
        descriptor={d}
        value={{ console: false }}
        {...baseProps}
      />,
    );
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});

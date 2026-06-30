/**
 * RecordField 标量值支持(L1):Record<string, scalar>(如 env)每条目渲染值输入框,
 * 增/改条目把标量直接作为条目值。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { RecordField } from "../../src/config/fields/record-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const scalarDescriptor: FieldDescriptor = {
  key: "env",
  kind: "record",
  label: "环境变量",
  required: false,
  itemKind: "string", // 标量值 record(无 fields)
};

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor: scalarDescriptor, value, onChange, path: ["env"], errors: {} };
  render(<RecordField {...props} />);
  return onChange;
}

describe("RecordField — 标量值 record", () => {
  it("每条目渲染单个值输入框,编辑把标量直接写为条目值", () => {
    const onChange = renderField({ HTTP_PROXY: "http://a" });
    const input = screen.getByDisplayValue("http://a");
    fireEvent.change(input, { target: { value: "http://b" } });
    expect(onChange).toHaveBeenLastCalledWith({ HTTP_PROXY: "http://b" });
  });

  it("新增条目初值为标量空串(非对象)", () => {
    const onChange = renderField({});
    fireEvent.change(screen.getByPlaceholderText(/新增条目键/), { target: { value: "KEY" } });
    fireEvent.click(screen.getByText("添加"));
    expect(onChange).toHaveBeenLastCalledWith({ KEY: "" });
  });
});

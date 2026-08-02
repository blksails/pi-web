/**
 * MultiEnumField(kind:"multiEnum",multi-gateway-providers 任务 5.4;Req 7.7)。
 *
 * 覆盖两件事:
 *  1. `FieldRenderer` 按 kind 正确分派到本控件(而非降级只读 JSON)—— providers 域的
 *     input/output 字段是这套渲染栈里第一个用到 multiEnum 的字段,DEFAULTS 表此前没有
 *     登记它,变异判据:把 field-renderer.tsx 里 `multiEnum: MultiEnumField` 这一行删掉,
 *     下面第一条用例就会转红(渲染出 `<pre>` 而不是勾选框)。
 *  2. 勾选 / 取消勾选正确增删数组元素,不影响其余已选值。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { FieldRenderer } from "../../src/config/field-renderer.js";

function desc(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    key: "input",
    kind: "multiEnum",
    label: "输入类型",
    required: false,
    enumOptions: [
      { value: "text", label: "文本" },
      { value: "image", label: "图像" },
      { value: "video", label: "视频" },
      { value: "audio", label: "音频" },
    ],
    ...over,
  };
}

describe("MultiEnumField — kind:\"multiEnum\" 分派与勾选", () => {
  it("FieldRenderer 按 kind 分派到勾选框控件,不降级为只读 JSON", () => {
    render(
      <FieldRenderer
        descriptor={desc()}
        value={["text"]}
        onChange={() => undefined}
        path={["input"]}
        errors={{}}
      />,
    );
    // 四个选项各一个 checkbox,而非 <pre> 只读文本。
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByText(/\[\s*"text"/)).not.toBeInTheDocument();
  });

  it("已选值对应勾选框为 checked,未选为未 checked", () => {
    render(
      <FieldRenderer
        descriptor={desc()}
        value={["text", "image"]}
        onChange={() => undefined}
        path={["input"]}
        errors={{}}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "文本" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "图像" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "视频" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "音频" })).not.toBeChecked();
  });

  it("勾选新选项 → onChange 追加,不丢已选值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldRenderer
        descriptor={desc()}
        value={["text"]}
        onChange={onChange}
        path={["input"]}
        errors={{}}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "图像" }));
    expect(onChange).toHaveBeenCalledWith(["text", "image"]);
  });

  it("取消勾选 → onChange 移除该项,保留其余", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldRenderer
        descriptor={desc()}
        value={["text", "image"]}
        onChange={onChange}
        path={["input"]}
        errors={{}}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "文本" }));
    expect(onChange).toHaveBeenCalledWith(["image"]);
  });

  it("未提供 value(undefined)时按空数组渲染,全部未选中且不崩溃", () => {
    render(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["input"]}
        errors={{}}
      />,
    );
    for (const cb of screen.getAllByRole("checkbox")) {
      expect(cb).not.toBeChecked();
    }
  });
});

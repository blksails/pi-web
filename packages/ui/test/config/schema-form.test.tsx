import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { authFormSchema, settingsFormSchema } from "@pi-web/protocol";
import { SchemaForm } from "../../src/config/schema-form.js";
import {
  createFieldRegistry,
  type FieldRendererComponent,
} from "../../src/config/field-registry.js";

describe("SchemaForm — settings(object + 分组)", () => {
  it("渲染分组标题与字段标签", () => {
    render(
      <SchemaForm
        formSchema={settingsFormSchema}
        values={{ theme: "system" }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("模型")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByText("默认 Provider")).toBeInTheDocument();
    expect(screen.getByText("主题")).toBeInTheDocument();
  });

  it("修改字段经 onChange 返回完整下一对象", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchemaForm
        formSchema={settingsFormSchema}
        values={{ theme: "system" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("默认 Provider");
    await user.type(input, "x");
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.theme).toBe("system"); // 保留其它字段
    expect(last.defaultProvider).toBe("x");
  });

  it("errors 按点路径就地呈现", () => {
    render(
      <SchemaForm
        formSchema={settingsFormSchema}
        values={{ theme: "system" }}
        errors={{ defaultProvider: "出错了" }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("出错了");
  });
});

describe("SchemaForm — auth(顶层 record + secret)", () => {
  it("渲染条目与掩码 secret,提供添加入口", () => {
    render(
      <SchemaForm
        formSchema={authFormSchema}
        values={{
          anthropic: { apiKey: { __secret: true, set: true, hint: "1234" } },
        }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText(/已设置/)).toHaveTextContent("1234");
    expect(screen.getByText("添加")).toBeInTheDocument();
  });

  it("添加条目经 onChange 写入新键", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchemaForm formSchema={authFormSchema} values={{}} onChange={onChange} />,
    );
    await user.type(screen.getByPlaceholderText(/新增条目键/), "openai");
    await user.click(screen.getByText("添加"));
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.openai).toEqual({});
  });

  it("自定义字段注册表覆盖能透传到 record 嵌套子字段(I2 回归)", () => {
    const registry = createFieldRegistry();
    const Custom: FieldRendererComponent = ({ descriptor }) => (
      <div data-custom-widget={descriptor.key}>custom:{descriptor.key}</div>
    );
    registry.registerByKey("apiKey", Custom);
    render(
      <SchemaForm
        formSchema={authFormSchema}
        values={{ anthropic: { apiKey: { __secret: true, set: true } } }}
        onChange={() => undefined}
        registry={registry}
      />,
    );
    // record 条目内的 apiKey 子字段应使用宿主注册的自定义渲染器
    expect(screen.getByText("custom:apiKey")).toBeInTheDocument();
  });
});

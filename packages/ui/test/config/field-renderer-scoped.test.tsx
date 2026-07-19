/**
 * FieldRenderer × per-source scoped field registry(任务 4.2 集成用例)。
 *
 * 覆盖:scoped 命中优先于全局、回收(unregisterSource)后回落全局、
 * widget 声明但两级注册表均未命中时降级只读 JSON、不同 source 之间隔离。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { FieldRenderer } from "../../src/config/field-renderer.js";
import {
  createFieldRegistry,
  createSourceFieldRegistry,
  type FieldRendererComponent,
} from "../../src/config/field-registry.js";

function desc(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { key: "entity", kind: "string", label: "Entity", required: false, ...over };
}

const GlobalWidget: FieldRendererComponent = () => <div>global-widget</div>;
const ScopedWidget: FieldRendererComponent = () => <div>scoped-widget</div>;
const OtherScopedWidget: FieldRendererComponent = () => <div>other-scoped-widget</div>;

describe("FieldRenderer — per-source scoped 查找顺序", () => {
  it("scoped 命中优先于全局(同 fieldKey 两处均注册)", () => {
    const registry = createFieldRegistry();
    registry.registerByKey("entity", GlobalWidget);
    const sourceFieldRegistry = createSourceFieldRegistry();
    sourceFieldRegistry.register("crm-source", "entity", ScopedWidget);

    render(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        registry={registry}
        sourceFieldRegistry={sourceFieldRegistry}
        sourceKey="crm-source"
      />,
    );
    expect(screen.getByText("scoped-widget")).toBeInTheDocument();
    expect(screen.queryByText("global-widget")).not.toBeInTheDocument();
  });

  it("未提供 sourceKey 时只查全局(不查 scoped)", () => {
    const registry = createFieldRegistry();
    registry.registerByKey("entity", GlobalWidget);
    const sourceFieldRegistry = createSourceFieldRegistry();
    sourceFieldRegistry.register("crm-source", "entity", ScopedWidget);

    render(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        registry={registry}
        sourceFieldRegistry={sourceFieldRegistry}
      />,
    );
    expect(screen.getByText("global-widget")).toBeInTheDocument();
  });

  it("回收(unregisterSource)后回落全局", () => {
    const registry = createFieldRegistry();
    registry.registerByKey("entity", GlobalWidget);
    const sourceFieldRegistry = createSourceFieldRegistry();
    sourceFieldRegistry.register("crm-source", "entity", ScopedWidget);
    sourceFieldRegistry.unregisterSource("crm-source");

    render(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        registry={registry}
        sourceFieldRegistry={sourceFieldRegistry}
        sourceKey="crm-source"
      />,
    );
    expect(screen.getByText("global-widget")).toBeInTheDocument();
    expect(screen.queryByText("scoped-widget")).not.toBeInTheDocument();
  });

  it("不同 source 之间隔离:source-b 拿不到 source-a 注册的 renderer", () => {
    const sourceFieldRegistry = createSourceFieldRegistry();
    sourceFieldRegistry.register("source-a", "entity", ScopedWidget);
    sourceFieldRegistry.register("source-b", "entity", OtherScopedWidget);

    const { rerender } = render(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        sourceFieldRegistry={sourceFieldRegistry}
        sourceKey="source-a"
      />,
    );
    expect(screen.getByText("scoped-widget")).toBeInTheDocument();

    rerender(
      <FieldRenderer
        descriptor={desc()}
        value={undefined}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        sourceFieldRegistry={sourceFieldRegistry}
        sourceKey="source-b"
      />,
    );
    expect(screen.getByText("other-scoped-widget")).toBeInTheDocument();
    expect(screen.queryByText("scoped-widget")).not.toBeInTheDocument();
  });

  it("声明 widget 但 scoped/全局均未命中(webext 未装/验签失败)→ 降级只读 JSON,不用 kind 默认控件", () => {
    const sourceFieldRegistry = createSourceFieldRegistry();
    render(
      <FieldRenderer
        descriptor={desc({ widget: "crmEntityPicker" })}
        value={{ id: "acc-1" }}
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
        sourceFieldRegistry={sourceFieldRegistry}
        sourceKey="crm-source"
      />,
    );
    // 只读 JSON 展示(pre 文本),不是 string kind 的默认 <input> 控件。
    expect(screen.getByText(/"id": "acc-1"/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("未声明 widget 时,即使未命中仍走 kind 默认控件(不受本变更影响)", () => {
    render(
      <FieldRenderer
        descriptor={desc()}
        value="hello"
        onChange={() => undefined}
        path={["entity"]}
        errors={{}}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

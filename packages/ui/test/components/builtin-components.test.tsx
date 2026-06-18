import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { builtinUiComponents } from "../../src/components/builtin-components.js";

const Metric = builtinUiComponents.metric;
const Table = builtinUiComponents.table;
const KeyValue = builtinUiComponents.keyValue;
const Alert = builtinUiComponents.alert;
const Progress = builtinUiComponents.progress;

describe("内置组件", () => {
  it("metric 正常渲染 label/value/delta", () => {
    render(
      <Metric props={{ label: "活跃", value: "1,284", delta: "+12%", tone: "success" }} />,
    );
    expect(screen.getByText("活跃")).toBeInTheDocument();
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
  });

  it("metric 容错:value 为对象时回退占位,不崩溃", () => {
    render(<Metric props={{ value: { nested: true } }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("table 正常渲染表头与单元格", () => {
    render(
      <Table props={{ columns: ["名称", "状态"], rows: [["api", "ok"]] }} />,
    );
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("table 容错:rows 非数组时不崩溃", () => {
    const { container } = render(
      <Table props={{ columns: ["A"], rows: "oops" }} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("keyValue 渲染行", () => {
    render(<KeyValue props={{ rows: [{ key: "版本", value: "1.0" }] }} />);
    expect(screen.getByText("版本")).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
  });

  it("alert 渲染 title/message 且有 status 角色", () => {
    render(<Alert props={{ tone: "warning", title: "注意", message: "msg" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("注意")).toBeInTheDocument();
  });

  it("progress 计算百分比", () => {
    render(<Progress props={{ value: 30, max: 60, label: "进度" }} />);
    expect(screen.getByText("进度")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("progress 容错:缺字段不崩溃", () => {
    const { container } = render(<Progress props={{}} />);
    expect(container.querySelector("[data-pi-ui-builtin='progress']")).not.toBeNull();
  });

  it("card 渲染 title/body/footer", () => {
    const Card = builtinUiComponents.card;
    render(<Card props={{ title: "标题", body: "正文", footer: "脚注" }} />);
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("正文")).toBeInTheDocument();
    expect(screen.getByText("脚注")).toBeInTheDocument();
  });

  it("codeBlock 渲染代码", () => {
    const CodeBlock = builtinUiComponents.codeBlock;
    const { container } = render(<CodeBlock props={{ code: "const x = 1", lang: "ts" }} />);
    expect(container.querySelector("[data-pi-ui-builtin='codeBlock']")).not.toBeNull();
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
  });
});

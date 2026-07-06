/**
 * 六组件渲染 smoke + cn 语义锚定(Req 1.1/1.4)。
 *
 * 迁移为非行为性:组件语义与迁移前 packages/ui/src/ui/* 逐一致——
 * 断言只锚定可挂载性、关键 role 与 design-tokens className(CSS 变量表达,
 * 不引入独立主题体系),不锚定完整类串。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Button,
  Card,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "../src/index.js";

describe("primitives 六组件渲染 smoke", () => {
  it("Button:可挂载,默认 type=button,variant/size 类生效且 className 可合并", () => {
    render(
      <Button variant="outline" size="sm" className="px-9">
        点我
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "点我" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.className).toContain("inline-flex");
    expect(btn.className).toContain("border-[hsl(var(--border))]");
    // tailwind-merge:调用方 px-9 覆盖 size=sm 的 px-3。
    expect(btn.className).toContain("px-9");
    expect(btn.className).not.toContain("px-3");
  });

  it("Card:可挂载,design-tokens 边框/圆角类生效", () => {
    const { container } = render(<Card data-testid="card">内容</Card>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.textContent).toBe("内容");
    expect(card.className).toContain("rounded-[var(--radius)]");
    expect(card.className).toContain("border-[hsl(var(--border))]");
  });

  it("Input:可挂载为 textbox,design-tokens 类生效", () => {
    render(<Input placeholder="输入" />);
    const input = screen.getByPlaceholderText("输入");
    expect(input.tagName).toBe("INPUT");
    expect(input.className).toContain("border-[hsl(var(--input))]");
    expect(input.className).toContain("h-9");
  });

  it("Textarea:可挂载为多行输入,design-tokens 类生效", () => {
    render(<Textarea placeholder="多行" />);
    const ta = screen.getByPlaceholderText("多行");
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.className).toContain("min-h-[60px]");
    expect(ta.className).toContain("border-[hsl(var(--input))]");
  });

  it("Popover:defaultOpen 时 Content 经 Portal 挂载,design-tokens 类生效", () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>开</PopoverTrigger>
        <PopoverContent>浮层内容</PopoverContent>
      </Popover>,
    );
    const content = screen.getByText("浮层内容");
    expect(content).toBeTruthy();
    expect(content.className).toContain("z-50");
    expect(content.className).toContain("rounded-[var(--radius)]");
  });

  it("Select:Trigger 以 combobox role 可挂载,含 chevron 图标与 tokens 类", () => {
    const { container } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="选一个" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项A</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger.className).toContain("border-[hsl(var(--input))]");
    expect(trigger.textContent).toContain("选一个");
    // lucide ChevronDown 渲染为 svg。
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("cn 语义锚定(clsx + tailwind-merge)", () => {
  it("条件合并:falsy 丢弃、数组/对象展开(clsx 语义)", () => {
    expect(cn("a", false && "b", undefined, ["c", { d: true, e: false }])).toBe("a c d");
  });

  it("tailwind 冲突裁决:后者胜(twMerge 语义)", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });

  it("同类重复去重", () => {
    expect(cn("text-sm", "text-sm")).toBe("text-sm");
  });

  it("零入参返回空串", () => {
    expect(cn()).toBe("");
  });
});

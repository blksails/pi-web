/**
 * @blksails/pi-web-primitives 包根出口 smoke 测试。
 *
 * 守护出口纪律(Req 1.1/1.2):
 * - src/index.ts 是唯一出口,可被解析;
 * - 出口面 = 六组件(Button/Card/Input/Popover/Select/Textarea 及其子件与
 *   buttonVariants)+ cn,与迁移前 packages/ui/src/ui/* + src/lib/cn.ts 的
 *   导出全集逐一致;
 * - 显式清单快照防漂移:任何导出增删改即红(semver 承诺面)。
 */
import { describe, it, expect } from "vitest";
import * as primitives from "../src/index.js";
import type { ButtonProps, InputProps, TextareaProps } from "../src/index.js";

describe("@blksails/pi-web-primitives public exports", () => {
  it("包根出口(唯一出口)可解析", () => {
    expect(primitives).toBeTypeOf("object");
  });

  it("出口纪律:包根值导出=六组件 15 项 + cn,无内部件泄漏(快照)", () => {
    expect(Object.keys(primitives).sort()).toEqual([
      "Button",
      "Card",
      "Input",
      "Popover",
      "PopoverAnchor",
      "PopoverContent",
      "PopoverTrigger",
      "Select",
      "SelectContent",
      "SelectGroup",
      "SelectItem",
      "SelectTrigger",
      "SelectValue",
      "Textarea",
      "buttonVariants",
      "cn",
    ]);
  });

  it("类型导出自包根出口可达(编译期守护;运行时锚定形状抽样)", () => {
    const buttonProps: ButtonProps = { variant: "outline", size: "sm" };
    const inputProps: InputProps = { placeholder: "p" };
    const textareaProps: TextareaProps = { rows: 3 };
    expect([buttonProps.variant, inputProps.placeholder, textareaProps.rows]).toEqual([
      "outline",
      "p",
      3,
    ]);
  });

  it("buttonVariants 是 CVA 函数(变体类生成可用)", () => {
    expect(primitives.buttonVariants({ variant: "outline", size: "sm" })).toContain("border");
  });
});

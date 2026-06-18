import { describe, expect, it } from "vitest";
import {
  UiSpecSchema,
  UiNodeSchema,
  UiStyleSchema,
} from "../../src/transport/ui-spec.js";
import { DataPartSchema } from "../../src/transport/data-part.js";

describe("UiSpecSchema", () => {
  it("解析 builtin 变体", () => {
    const spec = UiSpecSchema.parse({
      kind: "builtin",
      component: "metric",
      props: { label: "活跃", value: 42 },
      title: "概览",
    });
    expect(spec.kind).toBe("builtin");
  });

  it("解析 sandbox 变体(含嵌套 box)", () => {
    const spec = UiSpecSchema.parse({
      kind: "sandbox",
      root: {
        el: "box",
        direction: "col",
        style: { gap: "sm" },
        children: [
          { el: "heading", level: 2, text: "标题" },
          { el: "table", columns: ["A", "B"], rows: [["1", "2"]] },
        ],
      },
    });
    expect(spec.kind).toBe("sandbox");
  });

  it("拒绝未知 kind", () => {
    expect(
      UiSpecSchema.safeParse({ kind: "iframe", src: "x" }).success,
    ).toBe(false);
  });

  it("拒绝未知 el", () => {
    expect(
      UiNodeSchema.safeParse({ el: "script", text: "x" }).success,
    ).toBe(false);
  });

  it("拒绝危险 href(仅 http/https/mailto)", () => {
    expect(
      UiNodeSchema.safeParse({
        el: "link",
        text: "x",
        href: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      UiNodeSchema.safeParse({
        el: "link",
        text: "x",
        href: "https://example.com",
      }).success,
    ).toBe(true);
  });

  it("解析 image 节点(安全 src),拒绝危险 src", () => {
    expect(
      UiNodeSchema.safeParse({ el: "image", src: "https://x/y.png", alt: "y" }).success,
    ).toBe(true);
    expect(
      UiNodeSchema.safeParse({ el: "image", src: "data:image/png;base64,AAAA" }).success,
    ).toBe(true);
    expect(
      UiNodeSchema.safeParse({ el: "image", src: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("UiStyle 拒绝额外字段(.strict)", () => {
    expect(
      UiStyleSchema.safeParse({ tone: "primary", className: "evil" }).success,
    ).toBe(false);
  });
});

describe("DataPartSchema 含 data-pi-ui", () => {
  it("解析 data-pi-ui(builtin)", () => {
    const part = DataPartSchema.parse({
      type: "data-pi-ui",
      data: { kind: "builtin", component: "metric", props: {} },
    });
    expect(part.type).toBe("data-pi-ui");
  });

  it("仍解析既有 data-pi-queue(不破坏)", () => {
    expect(
      DataPartSchema.parse({
        type: "data-pi-queue",
        data: { steering: ["a"], followUp: [] },
      }).type,
    ).toBe("data-pi-queue");
  });

  it("拒绝 data-pi-ui 的非法 data", () => {
    expect(
      DataPartSchema.safeParse({
        type: "data-pi-ui",
        data: { kind: "builtin" },
      }).success,
    ).toBe(false);
  });
});

/**
 * canvas-watermark 组件单测(随源分发;spec cli-component-add,Req 8.1/8.4)。
 *
 * 接缝全部注入(SES-T4):bake 用注入的 fake ctx2d;Render/Inspector 是无 hooks 纯
 * 展示函数,直接以函数调用断言 ReactElement 形状(不依赖 RTL/DOM,jsdom 与 node 环境
 * 均可跑)。在仓内经 packages/canvas-ui/test/examples 的 wrapper 纳入套件;`pi-web add`
 * 拷入使用者 source 后亦可在其自己的测试设施下运行。
 */
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import type { ActionInput, WorkLayer } from "@blksails/pi-web-canvas-kit";
import {
  WATERMARK_DEFAULT,
  watermarkAction,
  watermarkBundle,
  watermarkLayer,
  watermarkTool,
  type WatermarkData,
} from "./watermark";

function layerWith(data?: WatermarkData): WorkLayer {
  return {
    id: "l1",
    attachmentId: "att_1",
    displayUrl: "https://example.test/att_1",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    kind: "watermark",
    ...(data !== undefined ? { data } : {}),
  } as WorkLayer;
}

function actionInput(overrides: Partial<ActionInput> = {}): ActionInput {
  return {
    imageId: "att_1",
    prompt: "",
    model: "",
    size: "",
    variants: 1,
    hasMask: false,
    hasExpand: false,
    referenceIds: [],
    capability: { actions: [] },
    ...overrides,
  } as ActionInput;
}

describe("watermarkLayer", () => {
  it("Render:按 scale 缩放字号、带 data-watermark-text 锚点与透明度", () => {
    const el = watermarkLayer.Render({
      layer: layerWith({ text: "hi", opacity: 0.5, size: 20 }),
      scale: 2,
    }) as ReactElement<{ style: { fontSize: string; opacity: number }; children: string }>;
    expect(el.props["data-watermark-text" as never]).toBeDefined();
    expect(el.props.style.fontSize).toBe("40px");
    expect(el.props.style.opacity).toBe(0.5);
    expect(el.props.children).toBe("hi");
  });

  it("Render:无 data 时回退默认值", () => {
    const el = watermarkLayer.Render({ layer: layerWith(), scale: 1 }) as ReactElement<{
      children: string;
    }>;
    expect(el.props.children).toBe(WATERMARK_DEFAULT.text);
  });

  it("bake:烤字并还原 globalAlpha", () => {
    const calls: Array<[string, number, number]> = [];
    const ctx = {
      fillStyle: "",
      fillRect: () => {},
      drawImage: () => {},
      translate: () => {},
      rotate: () => {},
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      globalAlpha: 1,
      font: "",
      fillText: (text: string, x: number, y: number) => {
        calls.push([text, x, y]);
      },
    };
    void watermarkLayer.bake(ctx as never, layerWith({ text: "wm", opacity: 0.4, size: 12 }), {
      w: 200,
      h: 100,
    });
    expect(calls).toEqual([["wm", 8, 88]]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("bake:fillText 原语缺省 → 退化跳过不抛(SES 判空降级)", () => {
    const bare = {
      fillStyle: "",
      fillRect: () => {},
      drawImage: () => {},
      translate: () => {},
      rotate: () => {},
      save: () => {},
      restore: () => {},
      clearRect: () => {},
    };
    expect(() => watermarkLayer.bake(bare as never, layerWith(), { w: 10, h: 10 })).not.toThrow();
  });

  it("Inspector:滑杆 onChange 以完整新 data 回写", () => {
    const updates: unknown[] = [];
    const el = watermarkLayer.Inspector?.({
      layer: layerWith({ text: "t", opacity: 0.3, size: 14 }),
      update: (d: unknown) => updates.push(d),
    }) as ReactElement<{ children: [string, ReactElement<{ onChange: (e: unknown) => void }>] }>;
    const slider = el.props.children[1];
    slider.props.onChange({ currentTarget: { value: "0.8" } });
    expect(updates).toEqual([{ text: "t", opacity: 0.8, size: 14 }]);
  });
});

describe("watermarkTool / watermarkBundle", () => {
  it("工具经 createLayer 声明点击置层(本地名,由消费方前缀化)", () => {
    expect(watermarkTool.createLayer).toEqual({ kind: "watermark", data: WATERMARK_DEFAULT });
    expect(watermarkTool.id).toBe("watermark");
  });

  it("捆自含图层类型,无 requires(组件不预知宿主命名空间)", () => {
    expect(watermarkBundle.requires).toBeUndefined();
    expect(watermarkBundle.layers).toContain(watermarkLayer);
    expect(watermarkBundle.tools).toContain(watermarkTool);
    expect(watermarkBundle.actions).toContain(watermarkAction);
  });
});

describe("watermarkAction 能力避让矩阵(SES-X3)", () => {
  it("prompt 前缀 + 白名单同时命中才参与决策", () => {
    const hit = actionInput({
      prompt: "watermark: 版权所有",
      capability: { actions: ["watermark_apply"] } as ActionInput["capability"],
    });
    expect(watermarkAction.match(hit)).toBe(80);
  });

  it("白名单缺失(任意无关 source)→ 不适用", () => {
    const noCap = actionInput({ prompt: "watermark: x" });
    expect(watermarkAction.match(noCap)).toBe(false);
  });

  it("prompt 前缀不符 → 不适用", () => {
    const noPrefix = actionInput({
      prompt: "画只猫",
      capability: { actions: ["watermark_apply"] } as ActionInput["capability"],
    });
    expect(watermarkAction.match(noPrefix)).toBe(false);
  });

  it("buildArgs:剥前缀作水印文本,空文本回退默认", () => {
    expect(watermarkAction.buildArgs(actionInput({ prompt: "watermark: hello " }))).toEqual({
      image: "att_1",
      text: "hello",
    });
    expect(watermarkAction.buildArgs(actionInput({ prompt: "watermark:" }))).toEqual({
      image: "att_1",
      text: WATERMARK_DEFAULT.text,
    });
  });
});

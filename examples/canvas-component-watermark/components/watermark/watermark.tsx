/**
 * canvas-watermark 组件(spec cli-component-add · 首个 kind:"component" 范例;
 * 源码车道设计:docs/component-installer-design.md)。
 *
 * 经 `pi-web add` 拷入目标 agent source 的 `.pi/web/components/watermark/` 后归使用者
 * 所有;按接线指引挂进 `defineWebExtension({ canvasPlugins: [watermarkBundle] })`,
 * `pi-web build` 编译生效。三件套与 canvas-plugin-stickers(车道①范例)同构:
 *  - `watermarkLayer`(defineCanvasLayer<WatermarkData>):文本水印图层。Render 按视口
 *    scale 显示;bake 拍平时把文本烤进 2D 上下文(fillText 原语缺省 → 退化跳过,不阻塞
 *    拍平);Inspector 提供透明度滑杆(update 传完整新 data);
 *  - `watermarkTool`(defineCanvasTool):水印工具。经 `createLayer` 声明「点击置层」,
 *    放置写路径归装配层(工具不直接改层);
 *  - `watermarkAction`(defineCanvasAction):批量水印动作。`via:"command"` 走命令通道
 *    (对应 agent 侧 `watermark_apply` 命令);`match` 经
 *    `capability.actions.includes("watermark_apply")` 避让 —— agent 未声明该命令
 *    (任意无关 source)时不参与决策(SES-X3 退化安全)。
 *
 * 命名空间:捆内 `id/type` 与 `createLayer.kind` 由消费方 `registerPluginBundles` 施加
 * `<宿主 manifestId>:` 前缀 —— 组件作者只写本地名,**不预知宿主命名空间**(与车道②插件包
 * 的关键差异:同一组件被两个 source 各自 add 是两个互不相干的插件实例)。捆自含其图层
 * 类型,故不声明 requires。
 *
 * 依赖纪律(准入 MUST):只 import 清单 `peer` 声明过的包与包内相对路径。
 */
import { defineCanvasAction, defineCanvasLayer, defineCanvasTool } from "@blksails/pi-web-canvas-kit";
import type { ActionInput, CanvasPluginBundle, WorkLayer } from "@blksails/pi-web-canvas-kit";

/** 水印图层私有数据(文本 + 透明度 0..1 + 字号 px)。 */
export interface WatermarkData {
  readonly text: string;
  readonly opacity: number;
  readonly size: number;
}

/** 放置初值(createLayer.data)。 */
export const WATERMARK_DEFAULT: WatermarkData = { text: "© pi-web", opacity: 0.35, size: 14 };

/** 透明度滑杆范围。 */
const OPACITY_MIN = 0.1;
const OPACITY_MAX = 1;

function dataOf(layer: WorkLayer): WatermarkData {
  return (layer.data as WatermarkData | undefined) ?? WATERMARK_DEFAULT;
}

/** 文本水印图层:Render 显文本、bake 烤字(原语缺省退化)、Inspector 调透明度。 */
export const watermarkLayer = defineCanvasLayer<WatermarkData>({
  type: "watermark", // 命名空间后 = "<宿主 manifestId>:watermark"
  Render: ({ layer, scale }) => {
    const d = dataOf(layer);
    return (
      <span
        data-watermark-text
        style={{
          fontSize: `${d.size * scale}px`,
          opacity: d.opacity,
          lineHeight: 1,
          whiteSpace: "nowrap",
          userSelect: "none",
          display: "inline-block",
        }}
      >
        {d.text}
      </span>
    );
  },
  bake: (ctx2d, layer, size) => {
    const d = dataOf(layer);
    // Ctx2DLike 的 font/fillText 为可选原语(旧注入 fake 可缺省)→ 无则退化跳过(拍平不阻塞)。
    if (typeof ctx2d.fillText !== "function") return;
    ctx2d.globalAlpha = d.opacity;
    if ("font" in ctx2d) ctx2d.font = `${d.size}px sans-serif`;
    ctx2d.fillText(d.text, 8, size.h - 12);
    ctx2d.globalAlpha = 1;
  },
  Inspector: ({ layer, update }) => {
    const d = dataOf(layer);
    return (
      <label data-watermark-inspector style={{ display: "flex", gap: 8, alignItems: "center" }}>
        透明度
        <input
          type="range"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={0.05}
          value={d.opacity}
          onChange={(e) => update({ ...d, opacity: Number(e.currentTarget.value) })}
        />
      </label>
    );
  },
});

/** 水印工具:createLayer 声明「点击置层」(放置写路径归装配层)。 */
export const watermarkTool = defineCanvasTool({
  id: "watermark", // 命名空间后 = "<宿主 manifestId>:watermark"
  label: "水印",
  icon: "💧",
  overlayInteractive: true,
  createLayer: { kind: "watermark", data: WATERMARK_DEFAULT },
});

/**
 * 批量水印动作(命令通道):prompt 以 "watermark:" 起头 + capability 白名单含
 * `watermark_apply` 时命中(评 80);其余一律不适用 —— 白名单避让使本组件装进任意
 * 无关 source 也不产生死按钮(退化安全)。
 */
export const watermarkAction = defineCanvasAction({
  id: "watermark-batch", // 命名空间后 = "<宿主 manifestId>:watermark-batch"
  label: "批量水印",
  match: (input: ActionInput) =>
    input.prompt.startsWith("watermark:") && input.capability.actions.includes("watermark_apply")
      ? 80
      : false,
  buildArgs: (input: ActionInput) => ({
    image: input.imageId,
    text: input.prompt.slice("watermark:".length).trim() || WATERMARK_DEFAULT.text,
  }),
  execution: { via: "command", command: "watermark_apply" },
});

/** 水印插件捆:自含图层类型,无 requires(见文件头「命名空间」)。 */
export const watermarkBundle: CanvasPluginBundle = {
  id: "watermark",
  tools: [watermarkTool],
  layers: [watermarkLayer],
  actions: [watermarkAction],
};

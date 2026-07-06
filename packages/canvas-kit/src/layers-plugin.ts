/**
 * layers-plugin — CanvasLayerPlugin / defineCanvasLayer(L2 图层插件契约核心;
 * task 1.1,Req 1.1/1.5)。
 *
 * design.md「canvas-kit · layers-plugin.ts(核心契约)」:第三方以对象字面量声明一种
 * 图层类型(如何渲染 Render、如何拍平 bake、如何在检查器 Inspector 里编辑参数),工具
 * 据此创建有自定义数据与交互的图层而无需改宿主。既有图像图层(WorkLayer 无 kind)行为
 * 零变:未注册类型声明的图层照现状渲染/拍平(Req 1.5,由 canvas-ui 装配层的 kind 分派
 * 守卫落实,契约层只提供声明与注册面)。
 *
 * 封装线(canvas-kit 零 @blksails 硬线,design「Allowed Dependencies」):Render/Inspector
 * 组件类型用 react **type-only** import(与 registry.ts `icon: ReactNode` 同级 —— 本包不
 * 运行 react,仅承载组件类型让 canvas-ui 装配层实例化);bake 的 2D 上下文用同层
 * `Ctx2DLike`(bitmap-io 家),WorkLayer 用 types 家,零跨包运行时依赖。
 *
 * 泛型 D(= 图层数据形状):与 defineCanvasTool<TDraft>/defineCanvasAction<TOp> 的类型
 * 收窄对称——作者可 `defineCanvasLayer<StickerData>({...})` 标注意图。契约面 update 载荷
 * 声明为 `unknown`(WorkLayer.data 在类型边界即 unknown,运行时由插件自行收窄),D 为
 * 声明期文档参数(phantom),不在成员上静态强绑——避免把 WorkLayer 泛型化外溢到既有图像
 * 图层路径(TS 不因未用类型参数报错;设计契约不含承载字段,故保持纯声明期)。
 *
 * 注:CanvasPluginBundle / registerPluginBundles(捆声明 + 命名空间前缀化 + requires
 * 拓扑校验)属 task 1.3,不在本模块本任务范围;registry 侧的 registerLayer/layers/
 * disabledPluginTools 登记面在 registry.ts(task 1.1 同批)。
 */
import type { ComponentType } from "react";
import type { WorkLayer } from "./types.js";
import type { Ctx2DLike } from "./bitmap-io.js";

/**
 * 图层插件(D = 图层数据形状,声明期文档参数)。Render/Inspector 为 react 组件类型
 * (type-only import;canvas-ui 装配层实例化)。
 */
export interface CanvasLayerPlugin<D = unknown> {
  /** 类型名(命名空间化后唯一,如 "acme-stickers:sticker";registerLayer 以此判冲突)。 */
  readonly type: string;
  /** 图层渲染组件(舞台按图层位置呈现,随视口 scale 缩放;Req 1.2)。 */
  readonly Render: ComponentType<{ readonly layer: WorkLayer; readonly scale: number }>;
  /**
   * 拍平:把图层内容烤进 2D 上下文(画布坐标已就绪;可异步如字体加载,Req 1.4)。
   * 产物与既有拍平链路一致地参与后续流程。
   */
  bake(ctx2d: Ctx2DLike, layer: WorkLayer, size: { readonly w: number; readonly h: number }): void | Promise<void>;
  /** 检查器组件(选中时编辑图层数据;编辑经 update 回写,Req 1.3)。 */
  readonly Inspector?: ComponentType<{ readonly layer: WorkLayer; update(data: unknown): void }>;
}

/** 声明式定义(恒等 + D 类型收窄;defineCanvasTool/defineCanvasAction 先例)。 */
export function defineCanvasLayer<D = unknown>(layer: CanvasLayerPlugin<D>): CanvasLayerPlugin<D> {
  return layer;
}

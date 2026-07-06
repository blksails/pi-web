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
 * 拓扑校验)属 task 1.3(本模块末尾编排段);registry 侧的 registerLayer/layers/
 * disabledPluginTools/recordPluginDiagnostic 登记面在 registry.ts(1.1 骨架 + 1.3 填充)。
 */
import type { ComponentType } from "react";
import type { WorkLayer } from "./types.js";
import type { Ctx2DLike } from "./bitmap-io.js";
import type { CanvasRegistry, CanvasTool } from "./registry.js";
import type { CanvasActionPlugin } from "./actions.js";

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

// ── CanvasPluginBundle / registerPluginBundles(task 1.3,Req 2.1/2.3/2.4/3.1/3.2/3.4)──

/**
 * 内置 op kind 归档常量:types.ts CanvasOp 注释「内置:"stroke" | "anno"」的可用依赖集
 * 镜像。canvas-kit 无运行时可枚举的内置 kind 注册表(自定义 kind 经工具 opKinds 动态注册),
 * 故拓扑校验的内置依赖来源档案化为常量——与 types.ts 同源人工同步(design File Structure
 * types.ts 注释即黄金基准;此常量随之变更时须同步复核)。
 */
const BUILTIN_OP_KINDS: readonly string[] = ["stroke", "anno"];

/**
 * 插件捆:一个扩展贡献的插件集合(id 未前缀化;registerPluginBundles 施加 <extId>: 命名空间)。
 * design.md「canvas-kit · layers-plugin.ts(核心契约)」CanvasPluginBundle 契约代码块为准。
 * requires = 依赖的图层类型 / op kind(**前缀化后**的全局名——作者写完整名,不被自动前缀化)。
 */
export interface CanvasPluginBundle {
  readonly id: string; // 捆 id(诊断归属)
  readonly requires?: readonly string[]; // 依赖的图层类型/op kind(全局名)
  readonly tools?: readonly CanvasTool[];
  readonly layers?: readonly CanvasLayerPlugin[];
  readonly actions?: readonly CanvasActionPlugin[];
}

/** 注册选项:namespace(= extId)存在时对捆内插件 id/type 施加 `<namespace>:` 前缀。 */
export interface RegisterPluginBundlesOptions {
  readonly namespace?: string;
}

/**
 * 注册编排(命名空间前缀化 + requires 拓扑校验;裁定 B):
 * ① namespace 存在时对捆内 tools/layers/actions 的 id/type 施加 `<namespace>:` 前缀(浅拷贝
 *    改 id/type,不 mutate 作者只读入参;requires 依赖名**不**前缀化——是全局名);
 * ② 先注册全部捆的 layers(前缀化后;同 type 冲突由 registerLayer 拒绝,先注册者保持);
 * ③ 构建可用依赖集 = 已注册 layer type 全集 ∪ 内置 op kind ∪ 各捆自带 layers 的 type;
 * ④ 逐捆校验 requires:全满足→注册该捆 tools/actions(正常);有缺失→捆内 tools 仍注册进
 *    工具轨但登记 registerDisabledPluginTool(置灰+tooltip 可见)、actions 不注册、追加
 *    diagnostics(kind:"plugin",toolId=捆前缀化 id,error 含缺失项);
 * ⑤ 返回聚合退订(注销本次注册的全部 tools/layers/actions)。
 * 同 id 冲突语义由底层 registerX 拒绝复用(不覆盖)。
 */
export function registerPluginBundles(
  registry: CanvasRegistry,
  bundles: readonly CanvasPluginBundle[],
  opts: RegisterPluginBundlesOptions = {},
): () => void {
  const prefix = opts.namespace ? `${opts.namespace}:` : "";
  const withPrefix = (name: string): string => `${prefix}${name}`;

  // ① 前缀化各捆声明(浅拷贝;无 namespace 时原样引用,零多余拷贝)。
  const prefixTool = (t: CanvasTool): CanvasTool => (prefix ? { ...t, id: withPrefix(t.id) } : t);
  const prefixLayer = (l: CanvasLayerPlugin): CanvasLayerPlugin =>
    prefix ? { ...l, type: withPrefix(l.type) } : l;
  const prefixAction = (a: CanvasActionPlugin): CanvasActionPlugin =>
    prefix ? { ...a, id: withPrefix(a.id) } : a;

  const prepared = bundles.map((b) => ({
    id: withPrefix(b.id), // 捆前缀化 id(诊断归属)
    requires: b.requires ?? [], // 依赖名不前缀化(全局名)
    tools: (b.tools ?? []).map(prefixTool),
    layers: (b.layers ?? []).map(prefixLayer),
    actions: (b.actions ?? []).map(prefixAction),
  }));

  const offs: Array<() => void> = [];

  // ② 先注册全部捆的 layers(供 ③ 跨捆依赖满足;同 type 冲突由 registerLayer 拒绝)。
  for (const b of prepared) {
    for (const layer of b.layers) offs.push(registry.registerLayer(layer));
  }

  // ③ 可用依赖集 = 已注册 layer type ∪ 内置 op kind ∪ 各捆自带 layers 的 type。
  const available = new Set<string>(BUILTIN_OP_KINDS);
  for (const l of registry.layers) available.add(l.type);
  for (const b of prepared) for (const l of b.layers) available.add(l.type);

  // ④ 逐捆 requires 校验。
  for (const b of prepared) {
    const missing = b.requires.filter((dep) => !available.has(dep));
    if (missing.length === 0) {
      for (const tool of b.tools) offs.push(registry.registerTool(tool));
      for (const action of b.actions) offs.push(registry.registerAction(action));
    } else {
      const reason = `缺少依赖: ${missing.join(", ")}`;
      for (const tool of b.tools) {
        // 裁定 B:工具仍进轨(置灰而非消失),登记禁用原因供 tooltip 消费。
        offs.push(registry.registerTool(tool));
        registry.registerDisabledPluginTool(tool.id, reason);
      }
      registry.recordPluginDiagnostic(b.id, reason); // kind:"plugin",toolId=捆前缀化 id
      // actions 不注册(不参与决策);layers 已在 ② 注册(渲染契约在,缺创建工具而已)。
    }
  }

  // ⑤ 聚合退订:注销本次注册的 layers/tools/actions(各 off 独立幂等)。
  //    禁用集(registerDisabledPluginTool)与诊断(recordPluginDiagnostic)为 append-only、
  //    无移除 API,退订后不清除;残留 id 因对应 tool 已被移除而无害(工具轨无此 tool 可置灰),
  //    诊断历史保留与 collector append-only 纪律一致(见 CONCERNS 档案化说明)。
  return () => {
    for (const off of offs) off();
  };
}

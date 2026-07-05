/**
 * builtin:expand — 扩图(边框手柄向外扩;task 3.2,Req 6.2/6.3)。
 *
 * 语义迁移自 canvas-workbench 扩图手柄(:1016-1051):down 记 `{edge, orig}`
 * (:1025-1027 闭包 startXY/orig 的声明化,orig=该边当前扩展量);move 消费路由
 * 载荷 `expandDelta`(边向外为正的**累计**底图像素位移,2.4 已换算 —— 旧
 * `deltaClient × perPx` :1031-1039 的等价物)写 `max(0, round(orig + Δ))`
 * (:1040);up 清 draft。手柄 DOM 留 workbench(:1633-1655,4.2 装配),本工具
 * 只消费 expand-handle 命中的路由事件。
 *
 * **扩图边状态通道裁定(design 未明示,本任务定夺)**:经 `ctx.prefs` 键
 * `expandEdges`(值 = ExpandEdges,缺省四边 0 = workbench :487 NO_EXPAND)。
 * 依据:L2 CanvasToolContext 是 semver 承诺面(design :215-227),其可写通道仅
 * draft/history.commit/prefs 三条 ——
 * - history.commit 违反行为回归:旧 setExpand(:1041)不入 ops,扩图**不可撤销**
 *   (undo 按钮只看 ops,:1441);
 * - draft 是手势期状态,而扩图边跨手势存续(直到复位/生成,:1672);
 * - prefs 是 2.6 专为「装配层双向绑定的工具局部状态」建的扁平 KV(PrefsStore
 *   subscribe/getSnapshot),4.2 已计划把既有 state 迁 prefs(tasks.md「annoColor/
 *   brushRatio **等**既有 state 迁 prefs KV」)—— expandEdges 同径:装配注入初值、
 *   订阅重渲(ext/baseRect/生成参数),复位按钮写同键。
 * 键名本任务定死(与 3.1 annoColor/brushRatio 同约):`expandEdges`。
 *
 * capture:缺省捕获(旧世界 window 级监听是「手柄 12px 小目标拖动跨元素」的续流
 * 手段,:1013-1015;路由会话下 capture 把后续指针事件钉在手柄上冒泡回容器入口,
 * 续流由 4.2 装配定夺,2.4 留账)。无 cursor(扩图下 overlay 不可交互 :865,
 * 手柄自带 resize 光标 :1637-1640)/无 op/无选项条/无 draft 光栅。
 */
import { createElement } from "react";
import { Expand } from "lucide-react";
import type { ExpandEdges } from "../types.js";
import { defineCanvasTool } from "../registry.js";

/** 扩图边状态的 prefs 键(4.2 装配注入初值/订阅须同键;值 = ExpandEdges)。 */
export const PREF_EXPAND_EDGES = "expandEdges";

/** 四边零扩展(workbench :487 NO_EXPAND 语义;prefs 未注入时的缺省)。 */
const NO_EXPAND: ExpandEdges = { top: 0, right: 0, bottom: 0, left: 0 };

/** 扩图手势 draft:拖拽边 + down 时该边扩展量(:1027 orig 闭包的声明化)。 */
export interface ExpandDraft {
  readonly edge: keyof ExpandEdges;
  readonly orig: number;
}

const edgesOf = (ctx: { prefs: { get<T>(key: string): T | undefined } }): ExpandEdges =>
  ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES) ?? NO_EXPAND;

export const expandTool = defineCanvasTool<ExpandDraft>({
  id: "builtin:expand",
  label: "扩图",
  icon: createElement(Expand, { className: "h-4 w-4" }),
  onDown: (ev, ctx) => {
    if (ev.hit.kind !== "expand-handle") return; // 手柄专属手势
    ctx.draft.set({ edge: ev.hit.edge, orig: edgesOf(ctx)[ev.hit.edge] });
  },
  onMove: (ev, ctx) => {
    const d = ctx.draft.get();
    if (d === null || ev.expandDelta === null) return; // 未启动 / 换算缺席帧丢弃(:1029-1030)
    const next = Math.max(0, Math.round(d.orig + ev.expandDelta)); // :1040
    const cur = edgesOf(ctx);
    if (cur[d.edge] === next) return; // 无实效变更:不重写(输出与旧逐帧 set 等价)
    ctx.prefs.set<ExpandEdges>(PREF_EXPAND_EDGES, { ...cur, [d.edge]: next });
  },
  onUp: (_ev, ctx) => {
    if (ctx.draft.get() !== null) ctx.draft.set(null); // 收束(:1043-1047 摘监听的等价)
  },
});

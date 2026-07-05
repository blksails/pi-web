/**
 * builtin:move — 移动(舞台平移;task 3.2,Req 6.2/6.3)。
 *
 * 语义迁移自 canvas-workbench 舞台平移(:1241-1252):**仅 stage 命中**启动平移
 * (design「System Flows」流程级决策:move 工具消费 stage 命中执行 ctx.stage.panBy;
 * 旧 onStageMouseDown :1242 `tool !== "move"` 门 + 空白舞台语义),消费**客户端
 * (屏幕 px)位移**(:1243/:1248 offset 直接吃屏幕坐标,2.4 裁定:stage 命中不要求
 * natural)。
 *
 * 累计→增量换算:事件载荷 `deltaClient` 是自 down 起的**累计**位移(路由 :1241-1248
 * 语义),而 ctx.stage.panBy 是**增量**平移 —— draft 记上一帧累计值,每帧 panBy
 * 差量,增量序列合计恒等于累计(与旧 `setOffset(offsetAtDown + Δ)` 逐帧等价)。
 * draft 即旧 `drag` ref(:1243 `{active, x, y}` 锚)的声明化;up 清 draft = endDrag
 * (:1250-1252)。
 *
 * capture:缺省捕获(旧世界是 stage 元素 mouse 监听 + onMouseLeave endDrag 的散点
 * 清理苟活,:1501-1504;路由会话下 capture 保证 up 必达、会话必收束,散点不再需要)。
 * cursor=grab(:1508;拖拽中 grabbing 是装配层的会话态样式,4.2)。
 * 无 draft 光栅/无 op(平移不可撤销,零 commit)/无选项条(:1391/:1416 条件不含 move)。
 */
import { createElement } from "react";
import { Hand } from "lucide-react";
import { defineCanvasTool } from "../registry.js";

/** 平移手势 draft:上一帧已消费的累计客户端位移(增量换算锚)。 */
export interface MoveDraft {
  readonly dx: number;
  readonly dy: number;
}

export const moveTool = defineCanvasTool<MoveDraft>({
  id: "builtin:move",
  label: "移动",
  icon: createElement(Hand, { className: "h-4 w-4" }),
  cursor: "grab",
  onDown: (ev, ctx) => {
    if (ev.hit.kind !== "stage") return; // 仅空白舞台平移(:1242 语义)
    ctx.draft.set({ dx: 0, dy: 0 });
  },
  onMove: (ev, ctx) => {
    const last = ctx.draft.get();
    if (last === null) return; // 无锚:未启动(:1246-1247 drag ref 守卫)
    ctx.stage.panBy(ev.deltaClient.dx - last.dx, ev.deltaClient.dy - last.dy);
    ctx.draft.set({ dx: ev.deltaClient.dx, dy: ev.deltaClient.dy });
  },
  onUp: (_ev, ctx) => {
    if (ctx.draft.get() !== null) ctx.draft.set(null); // endDrag(:1250-1252)
  },
});

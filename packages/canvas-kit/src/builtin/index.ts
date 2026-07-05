/**
 * builtin — 8 内置舞台工具汇总注册(task 3.2,Req 6.2/6.3;design File Structure
 * 「builtin/index.ts # registerBuiltinTools(registry)」)。
 *
 * 注册顺序 = 工具轨现状(workbench :1382-1389):move/expand/draw/line/arrow/
 * text/mask/erase —— registry.tools 按注册序稳定枚举(2.6),4.2 工具轨
 * map(registry.tools) 即得现状顺序。
 *
 * 出口纪律:单个工具对象**不出**包根(design L2 面只含 registerBuiltinTools,
 * :256;消费方经注册表枚举);id 冲突不可能(8 id 互异),diagnostics 恒零新增。
 */
import type { CanvasRegistry, CanvasTool } from "../registry.js";
import { moveTool } from "./move.js";
import { expandTool } from "./expand.js";
import { drawTool } from "./draw.js";
import { lineTool } from "./line.js";
import { arrowTool } from "./arrow.js";
import { textTool } from "./text.js";
import { maskTool } from "./mask.js";
import { eraseTool } from "./erase.js";

/** 工具轨顺序(:1382-1389)。 */
const BUILTIN_TOOLS = [
  moveTool,
  expandTool,
  drawTool,
  lineTool,
  arrowTool,
  textTool,
  maskTool,
  eraseTool,
] as const;

/** 8 内置工具按工具轨顺序注册进 per-instance 注册表(内置自举即扩展点验收)。 */
export function registerBuiltinTools(registry: CanvasRegistry): void {
  for (const tool of BUILTIN_TOOLS) registry.registerTool(tool as CanvasTool);
}

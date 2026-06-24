/**
 * AIGC 工具集装配入口。
 *
 * 提供两层接口:
 *  1. `AIGC_TOOLS` — 纯声明式 ToolSpec 数组(可从主入口安全导出,无运行时依赖)。
 *  2. `buildAigcTools(opts?)` — 编译为 pi ToolDefinition[],供 `defineAgent({ customTools })` 使用。
 *     属于**执行层**:经 compileTool 引入 pi SDK,仅从 `runtime` 子入口导出。
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { compileTool, type CompileDeps } from "../engine/compile-tool.js";
import { imageGeneration } from "./tools/image-generation.js";
import { imageEdit } from "./tools/image-edit.js";
import type { ToolSpec } from "../engine/types.js";

/** 本轮所有 ToolSpec 声明列表(纯数据,可从主入口安全导出)。 */
export const AIGC_TOOLS: readonly ToolSpec[] = [imageGeneration, imageEdit] as const;

/** `buildAigcTools` 选项。 */
export interface BuildAigcToolsOptions {
  /** 注入依赖(测试 mock ctx/fetch 等)。 */
  deps?: CompileDeps;
  /**
   * 只编译指定名称的工具(如 `["image_generation"]`)。
   * 省略则编译全部 AIGC_TOOLS。
   */
  include?: readonly string[];
}

/**
 * 把 AIGC ToolSpec 声明编译为 pi ToolDefinition 数组。
 *
 * 产物可直接放入 `defineAgent({ customTools: buildAigcTools() })`:
 * ```ts
 * import { buildAigcTools } from "@blksails/tool-kit/runtime";
 * const agent = defineAgent({ customTools: buildAigcTools(), ... });
 * ```
 */
export function buildAigcTools(
  options?: BuildAigcToolsOptions,
): ToolDefinition[] {
  const { deps, include } = options ?? {};
  const tools = include
    ? AIGC_TOOLS.filter((t) => include.includes(t.name))
    : AIGC_TOOLS;
  // compileTool 返回 ToolDefinition<TSchema, ToolExecuteDetails>;
  // 这里用 as ToolDefinition[] 宽化为调用方期望的无泛型形态(runtime only,不进前端)
  return tools.map((t) => compileTool(t, deps) as ToolDefinition);
}

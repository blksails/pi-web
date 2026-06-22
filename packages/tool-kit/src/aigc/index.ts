/**
 * AIGC 工具集装配入口。
 *
 * 提供两层接口:
 *  1. `AIGC_CATEGORIES` — 纯声明式 Category 数组(可从主入口安全导出,无运行时依赖)。
 *  2. `buildAigcTools(opts?)` — 编译为 pi ToolDefinition[],供 `defineAgent({ customTools })` 使用。
 *     属于**执行层**:经 compileCategory 引入 pi SDK,仅从 `runtime` 子入口导出。
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { compileCategory, type CompileDeps } from "../engine/compile-category.js";
import { textToImage } from "./categories/text-to-image.js";
import { imageEdit } from "./categories/image-edit.js";
import type { Category } from "../engine/types.js";

/** Wave 1 所有 Category 声明列表(纯数据,可从主入口安全导出)。 */
export const AIGC_CATEGORIES: readonly Category[] = [textToImage, imageEdit] as const;

/** `buildAigcTools` 选项。 */
export interface BuildAigcToolsOptions {
  /** 注入依赖(测试 mock ctx/fetch 等)。 */
  deps?: CompileDeps;
  /**
   * 只编译指定名称的工具(如 `["text_to_image"]`)。
   * 省略则编译全部 AIGC_CATEGORIES。
   */
  include?: readonly string[];
}

/**
 * 把 AIGC Category 声明编译为 pi ToolDefinition 数组。
 *
 * 产物可直接放入 `defineAgent({ customTools: buildAigcTools() })`:
 * ```ts
 * import { buildAigcTools } from "@pi-web/tool-kit/runtime";
 * const agent = defineAgent({ customTools: buildAigcTools(), ... });
 * ```
 */
export function buildAigcTools(
  options?: BuildAigcToolsOptions,
): ToolDefinition[] {
  const { deps, include } = options ?? {};
  const categories = include
    ? AIGC_CATEGORIES.filter((c) => include.includes(c.name))
    : AIGC_CATEGORIES;
  // compileCategory 返回 ToolDefinition<TSchema, ToolExecuteDetails>;
  // 这里用 as ToolDefinition[] 宽化为调用方期望的无泛型形态(runtime only,不进前端)
  return categories.map((c) => compileCategory(c, deps) as ToolDefinition);
}

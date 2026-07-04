/**
 * 配置域 — aigc(AIGC 图像工具设置,aigc-tool-settings)。
 *
 * 落 `~/.pi/agent/aigc.json`,由 aigcExtension 装配期读取:
 *  - disabledModels: 被禁用的图像模型 id 列表(自定义 widget `aigcModelToggles` 勾选清单;
 *    被禁模型从 LLM 可见枚举 + 下发清单移除,下次会话/重载生效)。
 *  - enablePromptOptimization: 是否开启工具提示词优化(默认关;本期接缝为无改写占位)。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";
import type { FieldGroup } from "../form-schema.js";

export const AIGC_GROUPS: readonly FieldGroup[] = [
  { id: "models", title: "模型", order: 1 },
  { id: "behavior", title: "行为", order: 2 },
];

export const aigcConfigSchema = z
  .object({
    disabledModels: z
      .array(z.string())
      .default([])
      .describe(
        JSON.stringify({
          label: "启用的图像模型",
          group: "models",
          order: 1,
          widget: "aigcModelToggles",
          description:
            "取消勾选即禁用该模型:被禁模型不再暴露给 LLM、也不在选择器出现。变更在下一次会话/重载后生效。",
        }),
      ),
    enablePromptOptimization: z
      .boolean()
      .default(false)
      .describe(
        JSON.stringify({
          label: "提示词优化",
          group: "behavior",
          order: 1,
          description: "开启后生成前对描述做优化处理(当前为占位,不改写)。",
        }),
      ),
  })
  .passthrough();

export const aigcFormSchema = zodToFormSchema("aigc", aigcConfigSchema, {
  title: "AIGC 图像工具",
  groups: AIGC_GROUPS,
});

/**
 * 配置域 — aigc(AIGC 图像工具设置,aigc-tool-settings)。
 *
 * 落 `~/.pi/agent/aigc.json`,由 aigcExtension 装配期读取:
 *  - disabledModels: 被禁用的图像模型 id 列表(自定义 widget `aigcModelToggles` 勾选清单;
 *    被禁模型从 LLM 可见枚举 + 下发清单移除,下次会话/重载生效)。
 *  - visionModel: `image_vision` 的默认视觉模型(自定义 widget `visionModelSelect`)。
 *    ★ 这个字段是**双向**的:用户可在 /settings 直接设,工具也会在用户于弹层里选过之后
 *    自动写回(见 tool-kit `vision/model-preference.ts`)。它与 disabledModels 的
 *    「只读装配期配置」性质不同 —— 修改它的代码路径有两条,别按单向配置理解。
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
    visionModel: z
      .string()
      .default("")
      .describe(
        JSON.stringify({
          label: "视觉模型(解读用)",
          group: "models",
          order: 2,
          widget: "visionModelSelect",
          description:
            "`image_vision` 解读图片时用哪个模型。留空 = 每次弹层询问;选定后不再询问。" +
            "首次在弹层里选过的模型会**自动记到这里**,可在此更改或清空。",
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

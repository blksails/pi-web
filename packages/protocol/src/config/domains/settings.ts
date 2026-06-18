/**
 * 配置域 — settings(`~/.pi/agent/settings.json`)。
 *
 * 默认偏好:默认 provider/model、默认思考等级、主题。passthrough 保留未知字段
 * (SDK 可能写入更多键),codec 合并写回时不丢。
 */
import { z } from "zod";
import { ThinkingLevelSchema } from "../../rpc/model.js";
import { zodToFormSchema } from "../zod-to-form-schema.js";
import type { FieldGroup } from "../form-schema.js";

export const SETTINGS_GROUPS: readonly FieldGroup[] = [
  { id: "model", title: "模型", order: 1 },
  { id: "appearance", title: "外观", order: 2 },
];

export const settingsConfigSchema = z
  .object({
    defaultProvider: z
      .string()
      .optional()
      .describe(
        JSON.stringify({
          label: "默认 Provider",
          group: "model",
          order: 1,
          placeholder: "如 anthropic / openrouter",
        }),
      ),
    defaultModel: z
      .string()
      .optional()
      .describe(
        JSON.stringify({
          label: "默认模型",
          group: "model",
          order: 2,
          placeholder: "如 anthropic/claude-sonnet-4.6",
        }),
      ),
    defaultThinkingLevel: ThinkingLevelSchema.optional().describe(
      JSON.stringify({
        label: "思考等级",
        group: "model",
        order: 3,
        enumLabels: {
          minimal: "最小",
          low: "低",
          medium: "中",
          high: "高",
          xhigh: "极高",
        },
      }),
    ),
    theme: z
      .enum(["light", "dark", "system"])
      .default("system")
      .describe(
        JSON.stringify({
          label: "主题",
          group: "appearance",
          order: 1,
          enumLabels: { light: "浅色", dark: "深色", system: "跟随系统" },
        }),
      ),
  })
  .passthrough();
export type SettingsConfig = z.infer<typeof settingsConfigSchema>;

export const settingsFormSchema = zodToFormSchema("settings", settingsConfigSchema, {
  title: "通用",
  groups: SETTINGS_GROUPS,
});

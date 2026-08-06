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
          // 可搜索下拉(选项来自 GET /api/config/models);未注册渲染器时回退文本框。
          widget: "providerSelect",
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
          // 可搜索下拉(选项来自 GET /api/config/models);未注册渲染器时回退文本框。
          widget: "modelSelect",
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
    /**
     * 聊天/工具输出中绝对路径的展示策略(仅影响 UI 显示,不改服务端落盘原文)。
     *  - off: 完整路径
     *  - home: `/Users/name/…` → `~/…`
     *  - basename: 仅最后一级目录(裸 home → `~`)
     */
    pathDisplay: z
      .enum(["off", "home", "basename"])
      .default("basename")
      .describe(
        JSON.stringify({
          label: "路径显示",
          group: "appearance",
          order: 2,
          description:
            "聊天与工具输出里本机绝对路径的展示方式。仅影响界面，不改历史落盘原文。",
          enumLabels: {
            off: "完整路径",
            home: "折叠用户目录为 ~",
            basename: "仅最后一级目录",
          },
        }),
      ),
    /**
     * 是否在对话中展示模型思考/reasoning 内容。
     * 默认 false：不渲染思考块；开启后流式期间可展开查看。
     */
    showReasoning: z
      .boolean()
      .default(false)
      .describe(
        JSON.stringify({
          label: "显示思考过程",
          group: "appearance",
          order: 3,
          description:
            "是否在对话中展示模型思考（reasoning）内容。关闭时默认不显示；开启后可在消息流中展开查看。",
        }),
      ),
  })
  .passthrough();
export type SettingsConfig = z.infer<typeof settingsConfigSchema>;

/** 设置缺省：不展示思考内容。 */
export const DEFAULT_SHOW_REASONING = false;

/** 解析 showReasoning；非法/缺失 → 默认 false。 */
export function parseShowReasoning(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  return DEFAULT_SHOW_REASONING;
}

export const settingsFormSchema = zodToFormSchema("settings", settingsConfigSchema, {
  title: "通用",
  groups: SETTINGS_GROUPS,
});

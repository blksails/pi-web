/**
 * 配置域 — logging（日志系统配置）。
 *
 * 双用途，共用同一 schema:
 *  - 全局:控制日志开关、级别、输出目标、命名空间过滤。
 *  - 前端面板:控制日志面板默认级别与可见性。
 *
 * 字段语义:
 *  - enabled: 是否启用日志系统
 *  - level: 全局最低日志级别
 *  - namespaces: 按命名空间的开关（自定义 widget: logNamespaceToggles）
 *  - outputs: 输出目标配置（控制台/文件/面板）
 *  - panelDefaultLevel: 前端日志面板默认显示级别
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";
import type { FieldGroup } from "../form-schema.js";

export const LOGGING_GROUPS: readonly FieldGroup[] = [
  { id: "general", title: "通用", order: 1 },
  { id: "components", title: "组件", order: 2 },
  { id: "output", title: "输出", order: 3 },
];

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

const logLevelEnum = z.enum(LOG_LEVELS);

const LOG_LEVEL_LABELS: Record<string, string> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

export const loggingOutputSchema = z
  .object({
    console: z.boolean().default(true).describe(
      JSON.stringify({ label: "控制台输出", group: "output", order: 1 }),
    ),
    file: z
      .object({
        enabled: z.boolean().optional(),
        path: z.string().optional(),
        maxSizeMb: z.number().optional(),
        maxFiles: z.number().optional(),
      })
      .optional()
      .describe(JSON.stringify({ label: "文件输出", group: "output", order: 2 })),
    panelVisible: z.boolean().default(true).describe(
      JSON.stringify({ label: "显示日志面板", group: "output", order: 3 }),
    ),
  })
  .optional();

export const loggingConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        JSON.stringify({
          label: "启用日志",
          group: "general",
          order: 1,
          description: "关闭后不采集任何日志",
        }),
      ),
    level: logLevelEnum
      .default("info")
      .describe(
        JSON.stringify({
          label: "日志级别",
          group: "general",
          order: 2,
          enumLabels: LOG_LEVEL_LABELS,
        }),
      ),
    namespaces: z
      .record(z.boolean())
      .optional()
      .describe(
        JSON.stringify({
          label: "按命名空间开关",
          group: "components",
          order: 1,
          widget: "logNamespaceToggles",
        }),
      ),
    outputs: z
      .object({
        console: z.boolean().default(true),
        file: z
          .object({
            enabled: z.boolean().optional(),
            path: z.string().optional(),
            maxSizeMb: z.number().optional(),
            maxFiles: z.number().optional(),
          })
          .optional(),
        panelVisible: z.boolean().default(true),
        panelPosition: z
          .enum(["bottom", "right", "drawer"])
          .default("bottom")
          .describe(
            JSON.stringify({
              label: "面板位置",
              group: "output",
              order: 4,
              enumLabels: { bottom: "底部", right: "右侧", drawer: "抽屉" },
            }),
          ),
      })
      .optional()
      .describe(
        JSON.stringify({
          label: "输出目标",
          group: "output",
          order: 1,
        }),
      ),
    panelDefaultLevel: logLevelEnum
      .default("info")
      .describe(
        JSON.stringify({
          label: "面板默认级别",
          group: "output",
          order: 2,
          enumLabels: LOG_LEVEL_LABELS,
        }),
      ),
  })
  .passthrough();

export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

export const loggingFormSchema = zodToFormSchema("logging", loggingConfigSchema, {
  title: "日志",
  groups: LOGGING_GROUPS,
});

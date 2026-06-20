/**
 * 配置域 — extensions(混合:固定「Slash 命令可用性」+ per-扩展 KV 参数)。
 *
 * 双用途共用同一 schema:
 *  - 全局:写 `~/.pi/agent/settings.json`。
 *  - 项目:写 `<cwd>/.pi/settings.json`。
 * 二者经自定义路由(extensions-config-routes)与 settings.json 结构互映:
 *  - `commands` → settings.json 的 `commands` 对象(pi-web 自有:限制前端暴露哪些 slash 命令;
 *    pi 忽略未知键)。
 *  - `extensions[<extId>]` → settings.json **顶层** per-扩展 KV 块(pi 据此向扩展传参,
 *    如 `"@alexgorbatchev/pi-env": {"HTTP_PROXY": "..."}`)。
 *
 * 全字段可选以支持稀疏/空文件(= 全部继承上层)。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";
import type { FieldGroup } from "../form-schema.js";

export const EXTENSIONS_GROUPS: readonly FieldGroup[] = [
  { id: "system", title: "系统资源", order: 0 },
  { id: "commands", title: "Slash 命令", order: 1 },
  { id: "ext", title: "扩展参数", order: 2 },
  { id: "files", title: "独立配置文件", order: 3 },
];

/** 固定的「工具/slash 命令」前端可用性限制(允许优先,留空=全部;再排除禁用)。 */
export const commandsAvailabilitySchema = z
  .object({
    allow: z
      .array(z.string())
      .optional()
      .describe(
        JSON.stringify({
          label: "允许的命令",
          order: 1,
          description: "留空 = 全部可用;非空 = 仅这些 slash 命令在前端可见",
        }),
      ),
    deny: z
      .array(z.string())
      .optional()
      .describe(
        JSON.stringify({
          label: "禁用的命令",
          order: 2,
          description: "从前端隐藏的 slash 命令(优先于允许)",
        }),
      ),
  })
  .passthrough();

export const extensionsConfigSchema = z
  .object({
    // pi-web 自有开关(写 settings.json 顶层键,pi 忽略未知键)。各自独立:关闭 → 建会话时
    // 给 agent 注入对应的 `--no-skills` / `--no-extensions`。默认开。
    loadSystemSkills: z
      .boolean()
      .optional()
      .describe(
        JSON.stringify({
          label: "载入系统 skills",
          group: "system",
          order: 1,
          description:
            "默认开。关闭后本会话不载入系统/包/内置 skills(经 --no-skills 生效;extensions 不受影响)。",
        }),
      ),
    loadSystemExtensions: z
      .boolean()
      .optional()
      .describe(
        JSON.stringify({
          label: "载入系统 extensions",
          group: "system",
          order: 2,
          description:
            "默认开。关闭后本会话不载入系统/包 extensions(经 --no-extensions 生效;skills 不受影响)。",
        }),
      ),
    commands: commandsAvailabilitySchema
      .optional()
      .describe(JSON.stringify({ label: "Slash 命令", group: "commands", order: 1 })),
    // per-扩展:extId → { enabled, spec, params }。自定义 widget "extensionsKv" 渲染
    // 每扩展「启用开关 + 两级 KV 增删」。enabled→packages[]/disabledPackages[] 成员关系;
    // spec 为原始 packages 规格(回写搬移用);params 为 settings.json 顶层 per-扩展 KV。
    extensions: z
      .record(
        z
          .object({
            enabled: z.boolean().optional(),
            spec: z.string().optional(),
            params: z.record(z.string()).optional(),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        JSON.stringify({
          label: "扩展",
          group: "ext",
          order: 1,
          widget: "extensionsKv",
          description: "逐个扩展的启用开关与 KV 参数(关闭 → 移入 disabledPackages,可重新开启)",
        }),
      ),
    // 独立配置文件:文件名 → 原始 JSON 内容(如 proxy.json)。自定义 widget "configFiles"。
    files: z
      .record(z.unknown())
      .optional()
      .describe(
        JSON.stringify({
          label: "独立配置文件",
          group: "files",
          order: 1,
          widget: "configFiles",
          description: "扩展自带的独立配置文件(原始 JSON 编辑;经 $schema 关联所属扩展)",
        }),
      ),
  })
  .passthrough();

export type ExtensionsConfig = z.infer<typeof extensionsConfigSchema>;

export const extensionsFormSchema = zodToFormSchema(
  "extensions",
  extensionsConfigSchema,
  { title: "扩展", groups: EXTENSIONS_GROUPS },
);

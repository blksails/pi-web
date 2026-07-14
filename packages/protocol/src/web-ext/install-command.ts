/**
 * web-ext 契约 — `/install` 结果卡片的 data 契约(spec install-host-command,任务 1.1)。
 *
 * `InstallResultData` 是 host 命令 `CommandResult.data`(见 `./command.ts`)的具体形状,
 * handler(`lib/app/install-host-command.ts`)与渲染器(`InstallResultRenderer`)共享同一份
 * schema。纯数据+zod,不依赖 CLI 子域的内部类型。
 */
import { z } from "zod";
import { PluginKindSchema } from "../plugin/plugin-manifest.js";

/** 单个安装步骤(来自 collector reporter),`detail` 在组装时已脱敏。 */
export const InstallStepSchema = z.object({
  /** reporter 的 ProgressStage 名。 */
  stage: z.string(),
  status: z.enum(["complete", "failed"]),
  detail: z.string().optional(),
});
export type InstallStep = z.infer<typeof InstallStepSchema>;

/** `/install` 结果卡片的 data 契约。所有 string 字段在组装时已过 `redactSecrets`。 */
export const InstallResultDataSchema = z.object({
  action: z.enum(["install", "uninstall", "list", "update"]),
  ok: z.boolean(),
  /** list 子动作没有单一 kind。 */
  kind: PluginKindSchema.optional(),
  /** 包名/source 名。 */
  id: z.string().optional(),
  /** agent 落点。 */
  location: z.string().optional(),
  /** agent:如何在选择器切换;component 拒绝:pi-web add 指引。 */
  guidance: z.string().optional(),
  steps: z.array(InstallStepSchema).default([]),
  /** list 子动作的表体。 */
  items: z
    .array(
      z.object({
        id: z.string(),
        version: z.string().optional(),
        scope: z.string().optional(),
        kind: z.string().optional(),
      }),
    )
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type InstallResultData = z.infer<typeof InstallResultDataSchema>;

/**
 * publish-command(spec publish-host-command,任务 1.1)——
 * `/agent publish` / `/plugin publish` **发布前预览**结果卡片的 data 契约。
 *
 * handler(`lib/app/publish-preview.ts`)与渲染器(`PublishPreviewRenderer`)共享同一份 schema。
 * 纯数据 + zod,不依赖 CLI 子域的内部类型。
 *
 * ## 为什么不复用 `InstallResultData`
 *
 * 那份 schema 是围绕装/卸/列/更新长出来的,三处装不下预览:
 *  1. `items` 的语义是**已安装的包**,而预览要列的是**文件**(带逐文件 integrity),
 *     塞进去会让 `id/version/scope` 全空;
 *  2. `steps.status` 只有 `complete | failed`,**非阻断告警塞进去两种渲染都不对** ——
 *     而"告警不得被吞掉"是本特性的硬要求(告警被吞 = 预览是假预览);
 *  3. "未签名 / 仅预览"的声明若只是 `guidance` 自由文本,渲染上与安装指引无从区分。
 *
 * ## `disclaimers` 为什么是布尔位而不是文案
 *
 * 文案会被翻译、改写、截断;布尔位不会。测试断言 `disclaimers.unsigned === true` 比断言
 * 某段中文子串稳固得多,也不会因为改文案而**静默失效**。渲染器据布尔位恒定渲染醒目提示。
 */
import { z } from "zod";
import { PluginKindSchema } from "../plugin/plugin-manifest.js";

/** 将纳入发布的单个文件及其完整性摘要。 */
export const PublishFileSchema = z.object({
  path: z.string(),
  integrity: z.string(),
});
export type PublishFile = z.infer<typeof PublishFileSchema>;

/**
 * 预览与真实发布的差异声明。两位都为 true 即"这只是一次编译校验"。
 * 将来接上真实发布时,发布成功的结果不应携带本对象(或两位皆 false)。
 */
export const PublishDisclaimersSchema = z.object({
  /** 未签名 → 结果不含发布者身份(publisher 指纹)与签名。 */
  unsigned: z.boolean(),
  /** 未校验发布授予与属主关系 —— 那些只有在真正发布时才判定。 */
  grantNotChecked: z.boolean(),
});
export type PublishDisclaimers = z.infer<typeof PublishDisclaimersSchema>;

/** `/…​ publish` 结果卡片的 data 契约。所有 string 字段在组装时已过 `redactSecrets`。 */
export const PublishPreviewDataSchema = z.object({
  ok: z.boolean(),
  /** 仅成功时存在:编译得出的包身份。 */
  package: z
    .object({
      id: z.string(),
      version: z.string(),
      kind: PluginKindSchema,
      displayName: z.string(),
    })
    .optional(),
  /** 将纳入发布的文件清单。**不截断** —— 截断而不说明会让人以为漏了文件。 */
  files: z.array(PublishFileSchema).default([]),
  /** 编译期非阻断告警。**一等字段**,不得并入 steps。 */
  warnings: z.array(z.string()).default([]),
  disclaimers: PublishDisclaimersSchema,
  /** 失败时的可区分说明;`hint` 给"改哪里"。 */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    })
    .optional(),
});
export type PublishPreviewData = z.infer<typeof PublishPreviewDataSchema>;

/** 卡片 data part 类型名(handler 经 `CommandResult.dataPart` 指定,渲染器据此注册)。 */
export const PUBLISH_PREVIEW_DATA_PART = "data-publish-preview";

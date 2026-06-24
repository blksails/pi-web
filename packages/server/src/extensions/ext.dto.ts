/**
 * extension-management — 对外 REST DTO(protocol 对齐的本地定义)。
 *
 * `@blksails/pi-web-protocol` 尚未导出 extension-management 的安装请求 / 结果 / 列表 DTO,故在此
 * 以与 protocol 一致的 zod + z.infer 风格本地定义,并注明对齐来源(Req 1.5)。一旦上游
 * 在 `@blksails/pi-web-protocol` 导出对应 schema,应改为从该包导入并删除此文件。
 */
import { z } from "zod";

/** POST /extensions 请求体:`{ source }`。 */
export const InstallExtensionRequestSchema = z.object({
  source: z.string().min(1),
});
export type InstallExtensionRequest = z.infer<
  typeof InstallExtensionRequestSchema
>;

/** POST /extensions 成功响应:`{ ok, source }`。 */
export const InstallResultResponseSchema = z.object({
  ok: z.literal(true),
  source: z.string(),
});
export type InstallResultResponse = z.infer<
  typeof InstallResultResponseSchema
>;

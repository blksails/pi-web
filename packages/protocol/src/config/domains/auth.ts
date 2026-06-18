/**
 * 配置域 — auth(`~/.pi/agent/auth.json`)。
 *
 * 务实结构:`record(provider → { apiKey(secret,必填), baseURL?(可选) })`,passthrough
 * 保留未知 provider 与未知子字段(codec 合并写回时不丢)。SDK 真实形状若有差异,因
 * codec 采"保留未知字段"语义而不致丢数据。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";

/** 已知 provider key(依据 lib/app/config.ts 的 env 命名),供 UI 建议补全。 */
export const KNOWN_PROVIDERS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "gemini",
  "mistral",
  "openrouter",
];

/** 单个 provider 的凭证对象。 */
export const authProviderSchema = z
  .object({
    apiKey: z
      .string()
      .min(1, "API Key 不能为空")
      .describe(JSON.stringify({ label: "API Key", secret: true })),
    baseURL: z
      .string()
      .url("需为合法 URL")
      .optional()
      .describe(
        JSON.stringify({ label: "Base URL", placeholder: "https://…(可选)" }),
      ),
  })
  .passthrough();
export type AuthProvider = z.infer<typeof authProviderSchema>;

/** auth.json 顶层:provider → 凭证。 */
export const authConfigSchema = z.record(authProviderSchema);
export type AuthConfig = z.infer<typeof authConfigSchema>;

/** auth 域的表单 IR(顶层为 record 字段,子字段为 apiKey/baseURL)。 */
export const authFormSchema = zodToFormSchema("auth", authConfigSchema, {
  title: "凭证",
});

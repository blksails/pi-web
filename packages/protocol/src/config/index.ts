/**
 * @pi-web/protocol — config 子面聚合导出(由 object schema 生成配置 UI 的契约根)。
 *
 * 表单 IR 类型 + UI 元数据 + zod→IR 适配器 + 各配置域 schema/FormSchema。
 * 下游(react/ui/server)经 @pi-web/protocol 主入口消费。
 */
export * from "./form-schema.js";
export * from "./meta.js";
export * from "./secret.js";
export * from "./zod-to-form-schema.js";
export * from "./domains/auth.js";
export * from "./domains/settings.js";

import type { FormSchema } from "./form-schema.js";
import { authFormSchema } from "./domains/auth.js";
import { settingsFormSchema } from "./domains/settings.js";

/** 配置域 id(P0)。 */
export type ConfigDomainId = "auth" | "settings";

/** 域 id → 该域表单 IR(供前端按 id 取 schema)。 */
export const CONFIG_FORM_SCHEMAS: Readonly<Record<ConfigDomainId, FormSchema>> = {
  auth: authFormSchema,
  settings: settingsFormSchema,
};

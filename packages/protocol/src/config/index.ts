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
export * from "./json-schema-to-form-schema.js";
export * from "./domains/auth.js";
export * from "./domains/settings.js";
export * from "./domains/sandbox.js";
// extensions 域经自定义互映路由(/config/extensions/{global,project}),不走通用 /config/:domain
// 机制,故仅导出其 schema/FormSchema 供路由与前端 import,**不**并入下方通用注册表
// (否则 2 段 /config/extensions 会被通用 :domain 路由遮蔽,且其 settings.json 顶层互映
//  无法用通用 codec 表达)。
export * from "./domains/extensions.js";
export * from "./domains/logging.js";

import type { FormSchema } from "./form-schema.js";
import { authFormSchema } from "./domains/auth.js";
import { settingsFormSchema } from "./domains/settings.js";
import { sandboxFormSchema } from "./domains/sandbox.js";
import { loggingFormSchema } from "./domains/logging.js";

/** 配置域 id(P0)。通用 `/config/:domain` 机制覆盖的域。 */
export type ConfigDomainId = "auth" | "settings" | "sandbox" | "logging";

/** 域 id → 该域表单 IR(供前端按 id 取 schema)。 */
export const CONFIG_FORM_SCHEMAS: Readonly<Record<ConfigDomainId, FormSchema>> = {
  auth: authFormSchema,
  settings: settingsFormSchema,
  sandbox: sandboxFormSchema,
  logging: loggingFormSchema,
};

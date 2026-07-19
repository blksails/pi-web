/**
 * 清单 `settings` 段 — per-source settings 声明面(spec: source-settings-and-slots,任务 1.1,Req 1)。
 *
 * agent source 作者在 `pi-web.json` 声明设置 schema(字段/标题/图标/作用域/依赖控件),
 * 宿主零改动动态长出面板。`schema` 只是指向 FormSchema 兼容静态 JSON 的相对路径(字符串),
 * 不在清单里内联表单 IR —— 复用既有 FormSchema IR(`packages/protocol/src/config/form-schema.ts`)
 * 的字段种类与 secret 三态契约,不新建表单 IR(Req 1.5)。
 *
 * 本段完全可选:未声明 `settings` 的清单解析结果零变化(向后兼容,Req 1.1/13.1/13.2)。
 */
import { z } from "zod";

/** per-source settings 值的持久化作用域:`source`(per-source×per-user,跨项目稳定) | `project`(per-source×per-cwd,受 trust 门控)。 */
export const PluginSettingsScopeSchema = z.enum(["source", "project"]);
export type PluginSettingsScope = z.infer<typeof PluginSettingsScopeSchema>;

/**
 * `settings` 段结构。`schema` 为相对包根的路径(指向 FormSchema 兼容静态 JSON,
 * 由服务端在解析期读取并 zod 校验;本段自身不承载表单字段结构)。
 */
export const PluginSettingsSchema = z.object({
  /** 指向 FormSchema 兼容静态 JSON 的相对路径(如 "settings/schema.json")。 */
  schema: z.string().min(1),
  /** 设置面板标题(菜单项/面板标题取此值)。 */
  title: z.string().optional(),
  /** 设置面板图标(渲染层图标名/URL,自由字符串,不在契约层钉死取值集合)。 */
  icon: z.string().optional(),
  /** 持久化作用域,缺省 "source"(per-source×per-user)。 */
  scope: PluginSettingsScopeSchema.default("source"),
  /** 依赖的动态控件键列表(须由本模块 webext settingsWidgets capability 提供,面⑤ 咬合点)。 */
  widgets: z.array(z.string()).optional(),
});
export type PluginSettings = z.infer<typeof PluginSettingsSchema>;

/**
 * 统一插件包清单契约 — `pi-plugin.json`(spec: plugin-system-unification)。
 *
 * 单一事实来源:在一个文件里声明同一逻辑插件的两层入口——
 *   - pi 原生资源(extensions/skills/prompts/themes,沿用 DefaultPackageManager 目录约定);
 *   - 可选 webext(.pi/web/dist,沿用 webext-package-install 约定)。
 * 缺失此清单时宿主回退既有目录约定(向后兼容),故本清单是「声明 + 校验」层,
 * 不改各自的物理发现机制。zero-runtime、isomorphic,与其它 protocol 契约同形。
 */
import { z } from "zod";

/**
 * 第一层:pi 原生资源入口(相对包根)。各字段省略时,宿主按 DefaultPackageManager
 * 目录约定全扫对应目录(`extensions/`/`skills/`/`prompts/`/`themes/`)。
 */
export const PluginPiResourcesSchema = z.object({
  extensions: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
});
export type PluginPiResources = z.infer<typeof PluginPiResourcesSchema>;

/** 第二层:web 面声明。`dist` 为 webext 产物目录;`commands` 为暴露到 web 命令补全的 slash 命令名。 */
export const PluginWebSchema = z.object({
  /** webext 产物目录(相对包根),含 manifest.json(SRI+签名) + web-extension.mjs。 */
  dist: z.string().optional(),
  /**
   * 声明暴露到 web 命令补全的 slash 命令名(plugin-system-unification 增量)。
   * 平台默认隐藏 `source:"extension"` 命令(防 busy 卡死的历史安全网);插件经此显式
   * opt-in,使其命令在 web 补全中默认可见(busy 卡死已由 fire-and-forget 修复)。
   */
  commands: z.array(z.string()).optional(),
});
export type PluginWeb = z.infer<typeof PluginWebSchema>;

/**
 * 两层契约锚点:声明哪些 pi 工具名由本插件 webext 接管渲染。
 * 供校验/文档用(pi registerTool(name) ↔ webext renderers.tools[name]),非运行时强约束。
 */
export const PluginBindingsSchema = z.object({
  tools: z.array(z.string()).optional(),
});
export type PluginBindings = z.infer<typeof PluginBindingsSchema>;

/**
 * `pi-plugin.json` 顶层清单。`id`/`version` 必填(两层共享同一逻辑标识与版本);
 * 未知字段被忽略(向前兼容,不 strict),非法字段由消费方解析时降级处理。
 */
export const PluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  pi: PluginPiResourcesSchema.optional(),
  web: PluginWebSchema.optional(),
  bindings: PluginBindingsSchema.optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** 清单文件名(包根)。 */
export const PLUGIN_MANIFEST_FILENAME = "pi-plugin.json";

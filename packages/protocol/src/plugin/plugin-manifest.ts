/**
 * 统一包清单契约 — `pi-web.json`(spec: plugin-system-unification)。
 *
 * 单一事实来源:在一个文件里声明同一逻辑包的两层入口——
 *   - pi 原生资源(extensions/skills/prompts/themes,沿用 DefaultPackageManager 目录约定);
 *   - 可选 webext(.pi/web/dist,沿用 webext-package-install 约定)。
 * 缺失此清单时宿主回退既有目录约定(向后兼容),故本清单是「声明 + 校验」层,
 * 不改各自的物理发现机制。zero-runtime、isomorphic,与其它 protocol 契约同形。
 *
 * ★ 本文件是**作者手写的源码期清单**(glob、无摘要、进 git)。它与 pi-clouds registry 权威
 * 定义的 `pi-web.manifest.json`(逐文件 sha384 + Ed25519 签名的**发布期编译产物**)是
 * 编译前 / 编译后的关系,不可混用:glob 不可签名,摘要不可手写。`pi-web publish` 负责
 * 展开 glob、逐文件计算 integrity、签名,产出后者。
 */
import { z } from "zod";

/**
 * 包类型判别式。决定 publish 编译出的 `pi-web.manifest.json` 走哪条路,以及 install 的落盘目标:
 *   - `agent`  — 可运行的 agent source;发布清单需 `entry`;装到 `~/.pi-web/agents/<name>`。
 *   - `plugin` — pi 资源集合(extensions/skills/prompts/themes);无 `entry`;经
 *                `DefaultPackageManager` 装到 `~/.pi/agent/`(user)或 `.pi/`(project)。
 *
 * 缺省为 `plugin`:本清单的全部存量实例(改名前的 `pi-plugin.json`)语义皆为 plugin,
 * 缺省值使其零迁移。`pi-web create` 始终显式写出本字段。
 *
 * 注:pi-clouds 侧 `SourceManifest.kind` 缺省为 `agent`(其存量数据皆为 agent source)。
 * 两侧缺省值不同各有其向后兼容理由,故 publish 编译时**必须显式写出** `kind`,不依赖任一侧缺省。
 */
export const PluginKindSchema = z.enum(["agent", "plugin"]);
export type PluginKind = z.infer<typeof PluginKindSchema>;

/**
 * 第一层:pi 原生资源入口(相对包根)。各字段省略时,宿主按 DefaultPackageManager
 * 目录约定全扫对应目录(`extensions/`/`skills/`/`prompts/`/`themes/`)。
 * 支持 glob 与 `!exclusions`;二者均在 `pi-web publish` 的编译期求值,发布清单里只剩确定的文件列表。
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
 * 两层契约锚点:声明哪些 pi 工具名由本包 webext 接管渲染。
 * 供校验/文档用(pi registerTool(name) ↔ webext renderers.tools[name]),非运行时强约束。
 */
export const PluginBindingsSchema = z.object({
  tools: z.array(z.string()).optional(),
});
export type PluginBindings = z.infer<typeof PluginBindingsSchema>;

/**
 * `pi-web.json` 顶层清单。`id`/`version` 必填(两层共享同一逻辑标识与版本);
 * 未知字段被忽略(向前兼容,不 strict),非法字段由消费方解析时降级处理。
 */
export const PiWebManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  kind: PluginKindSchema.default("plugin"),
  displayName: z.string().optional(),
  description: z.string().optional(),
  pi: PluginPiResourcesSchema.optional(),
  web: PluginWebSchema.optional(),
  bindings: PluginBindingsSchema.optional(),
});
export type PiWebManifest = z.infer<typeof PiWebManifestSchema>;

/** 清单文件名(包根)。 */
export const PI_WEB_MANIFEST_FILENAME = "pi-web.json";

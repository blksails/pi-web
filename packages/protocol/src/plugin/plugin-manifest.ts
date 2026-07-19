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
import { PluginSettingsSchema } from "./settings-schema.js";

/**
 * 包类型判别式。决定 publish 编译出的 `pi-web.manifest.json` 走哪条路,以及 install 的落盘目标:
 *   - `agent`     — 可运行的 agent source;发布清单需 `entry`;装到 `~/.pi-web/agents/<name>`。
 *   - `plugin`    — pi 资源集合(extensions/skills/prompts/themes);无 `entry`;经
 *                   `DefaultPackageManager` 装到 `~/.pi/agent/`(user)或 `.pi/`(project)。
 *   - `component` — 以源码交付的 UI 组件(spec: cli-component-add;shadcn 式车道):
 *                   `pi-web add` 把 `component.files` 拷进目标 agent source 的
 *                   `.pi/web/components/<id>/`,代码归使用者所有;不参与 publish/install 车道。
 *
 * 缺省为 `plugin`:本清单的全部存量实例(改名前的 `pi-plugin.json`)语义皆为 plugin,
 * 缺省值使其零迁移。`pi-web create` 始终显式写出本字段。
 *
 * 注:pi-clouds 侧 `SourceManifest.kind` 缺省为 `agent`(其存量数据皆为 agent source)。
 * 两侧缺省值不同各有其向后兼容理由,故 publish 编译时**必须显式写出** `kind`,不依赖任一侧缺省。
 */
export const PluginKindSchema = z.enum(["agent", "plugin", "component"]);
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
 * 组件接线声明(kind=component;spec: cli-component-add)。声明组件装入后挂到宿主
 * `web.config.tsx` 的哪个插件点。CLI 实现认 `canvasPlugins`(数组追加,v1)与
 * `slots`(具名槽对象键挂载,v1.1 · scene3d 设计稿 §7 M0);`renderers` 是 schema
 * 预留枚举值(结构合法但业务校验拒绝),为后续多插件点接线保留形状。
 */
export const ComponentWiringSchema = z.object({
  /** 插件点:宿主 defineWebExtension 配置里的目标键。 */
  point: z.enum(["canvasPlugins", "renderers", "slots"]),
  /**
   * 具名槽 key(仅 point:"slots" 有意义,业务校验要求必填;如 `panelRight`/
   * `launcherRail`/`promptToolbar`)。自由字符串:宿主槽位集合是开放的,不在契约层钉死。
   */
  slot: z.string().min(1).optional(),
  /** 组件模块的导出名(接线指引中的 import 绑定)。 */
  export: z.string().min(1),
  /** 相对目标 source `.pi/web/` 的 import 路径(接线指引中的 from 串)。 */
  from: z.string().min(1),
});
export type ComponentWiring = z.infer<typeof ComponentWiringSchema>;

/**
 * 组件字段组(kind=component 专属)。本 schema 只承载**结构**;跨字段业务规则
 * (files 必含测试文件、路径安全、target 必须等于约定落点、registryDeps v1 必须为空等)
 * 由 CLI 侧 `validateComponentManifest` 裁决 —— protocol 保持 zero-runtime 纯契约。
 */
export const ComponentSpecSchema = z.object({
  /** 要拷贝的源文件清单(相对组件包根)。 */
  files: z.array(z.string().min(1)).min(1),
  /** 落点(相对目标 source 根)。缺省即约定值 `.pi/web/components/<id>`。 */
  target: z.string().optional(),
  /** 接线声明。 */
  wiring: ComponentWiringSchema,
  /** peer 基线:包名 → 范围表达式(精确 | >= | ^ | ~)。 */
  peer: z.record(z.string(), z.string()).default({}),
  /** 组件间依赖(v2 预留;v1 业务校验要求为空)。 */
  registryDeps: z.array(z.string()).default([]),
});
export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;

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
  /** kind=component 时的组件字段组(其余 kind 忽略)。 */
  component: ComponentSpecSchema.optional(),
  /** per-source settings 声明面(可选,spec: source-settings-and-slots)。未声明时行为零变化。 */
  settings: PluginSettingsSchema.optional(),
});
export type PiWebManifest = z.infer<typeof PiWebManifestSchema>;

/** 清单文件名(包根)。 */
export const PI_WEB_MANIFEST_FILENAME = "pi-web.json";

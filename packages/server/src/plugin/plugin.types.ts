/**
 * 统一插件解析的运行时产物类型(spec: plugin-system-unification)。
 *
 * `PiWebManifest`(on-disk 契约)在 protocol;`PluginDescriptor`(解析后、含诊断与
 * 规范化路径)是 server 侧运行时产物,故定义于此。
 */
import type { PluginSettingsScope } from "@blksails/pi-web-protocol";

/**
 * 解析后的 per-source settings 切片(spec: source-settings-and-slots,任务 1.2,Req 1.2/1.3/1.4)。
 *
 * `schemaPath` 已校验对应文件存在(相对包根);未声明 settings 的清单该切片为 undefined,
 * 声明但 schema 文件缺失/非法同样为 undefined(降级为 diagnostics,不 fail 整个模块解析)。
 */
export interface PluginSettingsDescriptor {
  /** 指向 FormSchema 兼容静态 JSON 的相对包根路径,已校验存在且为合法 JSON。 */
  readonly schemaPath: string;
  readonly title?: string;
  readonly icon?: string;
  /** 持久化作用域,缺省 "source"。 */
  readonly scope: PluginSettingsScope;
  /** 依赖的动态控件键列表。 */
  readonly widgets: readonly string[];
}

/** 解析后的统一插件描述符。路径均相对包根、且经存在性校验(缺失项移入 diagnostics)。 */
export interface PluginDescriptor {
  /** 逻辑插件标识(两层共享)。来自清单 id,无清单时回退 package.json.name / 目录名。 */
  readonly id: string;
  /** 版本(两层共享)。来自清单 version,无清单时回退 package.json.version / "0.0.0"。 */
  readonly version: string;
  readonly displayName?: string;
  readonly description?: string;
  /** 第一层:实际存在的 pi 资源路径(相对包根)。 */
  readonly pi: {
    readonly extensions: readonly string[];
    readonly skills: readonly string[];
    readonly prompts: readonly string[];
    readonly themes: readonly string[];
  };
  /** 第二层:webext 产物目录(相对包根),仅在 `<dist>/manifest.json` 存在时给出。 */
  readonly web?: { readonly dist: string };
  /** 声明暴露到 web 命令补全的 slash 命令名(`pi-web.json` 的 `web.commands`);无则空。 */
  readonly webCommands: readonly string[];
  /** 两层契约锚点:由 webext 接管渲染的工具名。 */
  readonly bindings?: { readonly tools: readonly string[] };
  /** per-source settings 切片(spec: source-settings-and-slots);未声明或降级时 undefined。 */
  readonly settings?: PluginSettingsDescriptor;
  /** 被丢弃字段 / 产物缺失等可诊断原因(不使整包失败)。 */
  readonly diagnostics: readonly string[];
}

/**
 * 统一插件解析的运行时产物类型(spec: plugin-system-unification)。
 *
 * `PiWebManifest`(on-disk 契约)在 protocol;`PluginDescriptor`(解析后、含诊断与
 * 规范化路径)是 server 侧运行时产物,故定义于此。
 */

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
  /** 被丢弃字段 / 产物缺失等可诊断原因(不使整包失败)。 */
  readonly diagnostics: readonly string[];
}

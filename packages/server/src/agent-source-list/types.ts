/**
 * agent-source-list — 只读源枚举的内部类型(agent-sources-list)。
 *
 * `AgentSourceRecord` 是 provider 内部记录形态,端点投影为对外 DTO
 * (`@blksails/pi-web-protocol` 的 `AgentSourceItem`)前的中间表示。
 */

/** provider 内部记录(投影为对外 `AgentSourceItem` 前)。 */
export interface AgentSourceRecord {
  /** 稳定标识:dir→realpath 绝对路径;git→`url@ref`。 */
  readonly id: string;
  /** 可直接提交给会话创建链路的 source 字符串。 */
  readonly source: string;
  /** 显示名:registry.name > package.json name > 目录/repo 末段。 */
  readonly name: string;
  /** 源类型。 */
  readonly kind: "dir" | "git";
  /** 来源渠道。 */
  readonly origin: "scan" | "registry";
  /** 解析模式:含入口→custom;否则→cli(与真正建会话判定一致)。 */
  readonly mode: "custom" | "cli";
  /** 可选展示标题(比 name 更友好);列表用 title ?? name。 */
  readonly title?: string;
  /** 可选描述。 */
  readonly description?: string;
  /** 可选头像(图片 URL/data-URI 或短文本/emoji)。 */
  readonly avatar?: string;
}

/** 统一枚举抽象:只读、无副作用。 */
export interface AgentSourceProvider {
  list(): Promise<AgentSourceRecord[]>;
}

/** ScanSourceProvider 选项。 */
export interface ScanProviderOptions {
  /** 扫描根目录(绝对路径,可多个)。 */
  readonly roots: readonly string[];
}

/** RegistrySourceProvider 选项。 */
export interface RegistryProviderOptions {
  /** 注册表 JSON 路径(可不存在)。 */
  readonly registryPath: string;
}

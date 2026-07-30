/**
 * config · MCP 探测服务的**端口**(spec: core-package-extraction,任务 4.1)。
 *
 * 实现值依赖 MCP SDK,而内核包的依赖声明不得出现它(R1.2);内核走**源码直连**分发,
 * 消费方的 `tsc` 会编译到每个文件,故"声明成 optional peer"在本仓不可用 —— 缺类型即编译失败。
 * 于是按经典分工:**内核定端口,兼容层包实现,装配层注入**。
 *
 * ★ 端口只写路由真正用到的三个方法。把整个类的公开面照抄成接口,等于把实现的每次演进
 *   都变成端口的破坏性改动 —— 端口该由**消费者的需要**定义,不是由实现的形状定义。
 */
import type { McpServerConfig } from "@blksails/pi-web-protocol";

export type McpProbeStatus = "connected" | "failed" | "disabled" | "unknown";

/** 单个 MCP server 的探测结果。 */
export interface McpProbeResult {
  readonly name: string;
  readonly status: McpProbeStatus;
  /** 已脱敏的失败原因;仅 failed 时有值。 */
  readonly error?: string;
  /** 探测完成时间戳(ms);unknown(从未探测)时缺省。 */
  readonly checkedAt?: number;
  /** 连接成功时探到的工具数。 */
  readonly toolCount?: number;
}

/** MCP 探测服务端口。实现见兼容层包的 `mcp-probe` 模块。 */
export interface McpProbePort {
  /** 读缓存中的状态快照(不触发探测)。 */
  status(servers: readonly McpServerConfig[]): readonly McpProbeResult[];
  /** 按需真实探测并刷新缓存;`only` 给定时只探该名字的一条。绝不抛出。 */
  probe(
    servers: readonly McpServerConfig[],
    only?: string,
  ): Promise<readonly McpProbeResult[]>;
  /** 收敛缓存到给定名单(配置删除后清理陈旧条目)。 */
  retain(names: readonly string[]): void;
}

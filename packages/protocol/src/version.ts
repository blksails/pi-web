/**
 * protocolVersion — pi-web 协议契约的语义化版本常量。
 *
 * 用途:SSE 帧握手与漂移防护(前后端在流式过程中协商版本)。
 * 该版本独立于 pi 自身版本;pi 对齐版本为 0.79.x(见 rpc/* 文件头)。
 *
 * 任一导出 schema 的形状变更(字段增删 / 判别字段变更)应按 SemVer 升级此常量。
 */

/** 语义化版本(SemVer)字符串字面量类型。 */
export type ProtocolVersion = `${number}.${number}.${number}`;

/**
 * 当前协议契约版本(SemVer)。
 * 被 transport/sse-frame.ts 引用并随帧传递。
 */
export const protocolVersion: ProtocolVersion = "0.1.0";

/**
 * desktop-cloud-login · egress 模型描述类型(pi-SDK-free)。
 *
 * 从 `egress-model-source`(引 pi SDK 值)抽出纯类型,使 barrel 与 app 装配层可安全引用,
 * 而不牵连 pi SDK 值导入。
 */

/** 一个经 egress 暴露的模型(最小描述;缺省字段由 runner 侧用保守默认补齐)。 */
export interface EgressModel {
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
  readonly input?: ReadonlyArray<"text" | "image">;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

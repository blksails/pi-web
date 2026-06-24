/**
 * completion-provider-framework — 服务端 provider 契约与上下文类型。
 *
 * 仅服务端可见(含函数,不可序列化)。线协议形状见 `@blksails/protocol`
 * 的 completion-dto(CompletionItem/CompletionResponse/TriggersResponse)。
 */
import type {
  CompletionItem,
  CompletionExtractRule,
} from "@blksails/protocol";

/** 注入给 provider 的会话上下文(服务端组装,provider 不得自前端取)。 */
export interface CompletionCtx {
  readonly sessionId: string;
  readonly cwd: string;
  readonly userId: string;
}

/** 提交期从消息文本扫描出的一个补全引用(token)。 */
export interface CompletionRef {
  readonly kind: string;
  readonly id: string;
  /** 原始 token 文本(如 `@file:src/a.ts`),解析失败时用于原样保留。 */
  readonly raw: string;
}

/** provider.resolve 的产物:v1 仅给出替换 token 的文本。 */
export interface ResolvedContext {
  readonly text: string;
}

/**
 * 可插拔补全 provider。一个 provider 一个触发符语义(单一 `trigger`);
 * 多触发符能力经注册多个 provider 达成,而非单 provider 声明数组。
 */
export interface CompletionProvider {
  /** 全局唯一 id。 */
  readonly id: string;
  /** 单一规范触发符(注册时校验为单字符)。 */
  readonly trigger: string;
  /** token 提取规则(缺省 wordTail)。 */
  readonly extract?: CompletionExtractRule;
  /** 候选语义类型(缺省取 id),用于前端分组/去重键。 */
  readonly kind?: string;
  /** 跨 provider 排序优先级(缺省 0,越大越靠前)。 */
  readonly priority?: number;
  /** 按查询返回候选(已注入 ctx)。 */
  complete(args: {
    readonly query: string;
    readonly ctx: CompletionCtx;
  }): Promise<readonly CompletionItem[]>;
  /** 提交期把选中引用解析为上下文文本;缺省则保留原文本。 */
  resolve?(
    ref: CompletionRef,
    ctx: CompletionCtx,
  ): Promise<ResolvedContext | null>;
}

/** provider 的 kind(缺省取 id)。 */
export function providerKind(p: CompletionProvider): string {
  return p.kind ?? p.id;
}

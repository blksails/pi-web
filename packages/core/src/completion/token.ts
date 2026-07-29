/**
 * completion-provider-framework — 带类型回环的 token 文法(前后端约定一致)。
 *
 * 形如 `<trigger><kind>:<id>`,例如 `@file:src/a.ts`。
 * 关键:必须带 `kind:` 前缀才算 token;裸 `@someone`(无冒号)视为普通文本,不误判。
 */
import type { CompletionRef } from "./types.js";

/** kind 词法:小写字母起头的标识符。 */
const KIND = "[a-z][a-z0-9_-]*";
/** id 词法:非空白(允许路径分隔/点/连字符等)。 */
const ID = "[^\\s]+";

/** 全局扫描所有 token 的正则(支持 @ / $ / # 等单字符触发符)。 */
const TOKEN_RE = new RegExp(`([@$#/])(${KIND}):(${ID})`, "g");

/** 序列化一个候选为 token 文本。 */
export function serializeToken(args: {
  trigger: string;
  kind: string;
  id: string;
}): string {
  return `${args.trigger}${args.kind}:${args.id}`;
}

/** 从消息文本扫描出全部补全 token(顺序稳定)。无 token 返回空数组。 */
export function parseTokens(text: string): readonly CompletionRef[] {
  const refs: CompletionRef[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    refs.push({ kind: m[2] as string, id: m[3] as string, raw: m[0] as string });
  }
  return refs;
}

/** 带位置的 token 匹配(供 resolve 位置式重写,避免前缀 token 互相污染)。 */
export interface TokenMatch extends CompletionRef {
  readonly index: number;
  readonly length: number;
}
export function tokenMatches(text: string): readonly TokenMatch[] {
  const out: TokenMatch[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0] as string;
    out.push({
      kind: m[2] as string,
      id: m[3] as string,
      raw,
      index: m.index ?? 0,
      length: raw.length,
    });
  }
  return out;
}

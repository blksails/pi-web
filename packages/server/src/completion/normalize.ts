/**
 * completion-provider-framework — 触发符归一化层。
 *
 * 把等价字符形态(主要是中文输入法全角)规约为规范触发符,使 provider 只认规范符,
 * 接口无需声明多符。未知符原样返回。
 */

/** 等价形态 → 规范触发符。可按需扩展别名。 */
const TRIGGER_ALIASES: Readonly<Record<string, string>> = {
  "＠": "@", // 全角 commercial at (U+FF20)
  "￥": "$", // 全角 yen / 常见替代 $（U+FFE5）
  "＄": "$", // 全角 dollar (U+FF04)
  "／": "/", // 全角 solidus (U+FF0F)
  "＃": "#", // 全角 number sign (U+FF03)
};

/** 把可能为等价形态的触发符规约为规范触发符;未知/已规范者原样返回。 */
export function normalizeTrigger(ch: string): string {
  return TRIGGER_ALIASES[ch] ?? ch;
}

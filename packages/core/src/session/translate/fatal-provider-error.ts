/**
 * session-engine / translate — 致命 provider 错误判定(纯函数)。
 *
 * 背景:pi SDK(`@earendil-works/pi-ai`)的重试分类器 `isRetryableAssistantError` 用**裸数字
 * 子串** `429|500|502|503|504` 正则匹配整条 errorMessage。OpenRouter 的余额不足(402)报文里
 * 会嵌入 token 数字(如 `can only afford 5021`),其中的 `502` 子串被误命中 → 402 被误判为
 * 「可重试的 5xx transient」,触发 agent-level auto-retry 反复重试(maxRetries 次、指数退避),
 * 直到耗尽才终止 —— 用户体感是「出错了不立刻终止、要等十几秒」。且 afford 数字随机波动
 * (5021 命中 502、5169 不命中),行为时好时坏。
 *
 * 该分类器的「不可重试」模式库(`billing`/`quota exceeded`/`insufficient_quota`/
 * `available balance`)也**不认** OpenRouter/多数网关的措辞(`requires more credits`/
 * `can only afford`),故拦不下。
 *
 * 本判定补齐这一层:识别**确定致命**(账单/额度/配额/付费/402)的错误。命中者由
 * `translateEvent` 在 `auto_retry_start` 入口 fail-fast 终止本轮(合成 error+finish),
 * 由 `PiSession` 侧 `abort` 中止 agent 的重试循环。真正的 5xx/429/网络 transient 不命中本
 * 判定,照常重试。
 *
 * 判据只按错误文本**语义**,不按裸状态码子串(避免重蹈 SDK 的覆辙 —— 402 用带上下文的
 * `402:` / `"code":402` 锚定,不用裸 `402` 以免误伤 token 数字如 `228402`)。
 */

/** 账单/额度/配额/付费类致命措辞(大小写不敏感;覆盖 OpenRouter/OpenAI/常见网关表达)。 */
const FATAL_TEXT_PATTERN =
  /requires? more credits|can only afford|insufficient[_ ]?(?:quota|credits|balance|funds)|out of (?:budget|credits)|quota (?:exceeded|exhausted)|\bbilling\b|payment required|available balance|usage limit reached|GoUsageLimitError|FreeUsageLimitError/i;

/** HTTP 402 Payment Required:带上下文锚定(`402:` 前缀或 `"code":402`),避免误伤嵌入的 token 数字。 */
const HTTP_402_PATTERN = /(?:^|[^0-9])402\s*:|"code"\s*:\s*402/;

/**
 * 该失败错误消息是否表示**确定致命**(不该重试、应立即终止)的 provider 错误。
 * 空/未定义 → `false`(无信息不擅自判致命,交由既有重试/终止路径)。
 */
export function isFatalProviderError(errorMessage: string | undefined): boolean {
  if (errorMessage === undefined || errorMessage === "") return false;
  return FATAL_TEXT_PATTERN.test(errorMessage) || HTTP_402_PATTERN.test(errorMessage);
}

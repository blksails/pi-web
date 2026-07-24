import { describe, expect, it } from "vitest";
import { isFatalProviderError } from "../../src/session/translate/fatal-provider-error.js";

describe("isFatalProviderError", () => {
  // ★ 真实向量:这条 OpenRouter 402 报文正是 pi SDK 的重试分类器 `isRetryableAssistantError`
  //   会**误判为可重试 502** 的那条 —— 它对整条 errorMessage 跑裸 `502` 子串,命中了
  //   `afford 5021` 里的 `502`。本判定必须把它判为致命(不该重试)。
  const REAL_402 =
    '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 228422 tokens, but can only afford 5021. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402,"metadata":{"provider_name":null}}';

  it("真实 OpenRouter 402(afford 5021)→ 致命", () => {
    expect(isFatalProviderError(REAL_402)).toBe(true);
  });

  it.each([
    ["402 前缀", "402: payment required"],
    ["code:402", '{"code":402,"message":"nope"}'],
    ["requires more credits", "Provider: this request requires more credits"],
    ["can only afford", "you can only afford 3 tokens"],
    ["insufficient_quota", "insufficient_quota: add funds"],
    ["insufficient credits", "insufficient credits remaining"],
    ["quota exceeded", "Your quota exceeded for this month"],
    ["billing", "billing hard limit reached"],
    ["available balance", "enable available balance to continue"],
    ["usage limit reached", "Monthly usage limit reached"],
    ["out of credits", "account is out of credits"],
    ["payment required", "HTTP Payment Required"],
  ])("致命措辞:%s → 致命", (_name, msg) => {
    expect(isFatalProviderError(msg)).toBe(true);
  });

  it.each([
    ["503 transient", "503 Service Unavailable"],
    ["500 server error", "500 internal server error"],
    ["429 rate limit", "429 too many requests, rate limit"],
    ["网络失败", "fetch failed: connection refused"],
    ["timeout", "request timed out"],
    ["provider returned error", "Provider returned error"],
    ["普通文本", "boom"],
    // ★ 不误伤(直击根因):错误消息里嵌的 token 数字含 402/502 子串,但无致命语义 → 非致命。
    //   这正是 SDK 栽跟头的反面 —— 我们按语义判定,绝不用裸状态码子串。
    ["嵌入数字 228402 无致命语义", "You requested up to 228402 tokens but the stream ended without a response"],
    ["嵌入数字 5021 无致命语义", "server error while processing 5021 tokens"],
  ])("非致命 transient / 不误伤:%s → 非致命", (_name, msg) => {
    expect(isFatalProviderError(msg)).toBe(false);
  });

  it("空 / 未定义 → 非致命", () => {
    expect(isFatalProviderError(undefined)).toBe(false);
    expect(isFatalProviderError("")).toBe(false);
  });
});

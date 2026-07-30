/**
 * attachment-store · 公开 id 铸造工具单元测试(Req 2.3)。
 *
 * 断言:
 * - 前缀为 `att_`;
 * - `att_` 之后的随机串为 URL-safe(base64url 字符集:A-Z a-z 0-9 - _,无 `+` `/` `=`);
 * - 批量生成无重复(单一身份的前置保障);
 * - 不可顺序枚举(随机串无单调/可预测的顺序规律)。
 */
import { describe, expect, it } from "vitest";
import { mintAttachmentId } from "../../src/attachment/id.js";

const PREFIX = "att_";
/** base64url 字符集(URL-safe),不含 `+` `/` `=`。 */
const URL_SAFE_BODY_RE = /^[A-Za-z0-9_-]+$/;

describe("mintAttachmentId", () => {
  it("以 `att_` 前缀开头", () => {
    const id = mintAttachmentId();
    expect(id.startsWith(PREFIX)).toBe(true);
  });

  it("`att_` 之后的随机串为 URL-safe(base64url 字符集)", () => {
    for (let i = 0; i < 200; i++) {
      const id = mintAttachmentId();
      const body = id.slice(PREFIX.length);
      expect(body.length).toBeGreaterThan(0);
      expect(body).toMatch(URL_SAFE_BODY_RE);
      // 显式拒绝标准 base64 的非 URL-safe 字符。
      expect(id.includes("+")).toBe(false);
      expect(id.includes("/")).toBe(false);
      expect(id.includes("=")).toBe(false);
    }
  });

  it("批量生成无重复", () => {
    const N = 10_000;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      seen.add(mintAttachmentId());
    }
    expect(seen.size).toBe(N);
  });

  it("不可顺序枚举:随机串不呈单调/可预测顺序规律", () => {
    const N = 500;
    const bodies = Array.from({ length: N }, () =>
      mintAttachmentId().slice(PREFIX.length),
    );

    // 1) 随机串长度一致(等长随机字节 → 等长 base64url),否则可由长度推测。
    const lengths = new Set(bodies.map((b) => b.length));
    expect(lengths.size).toBe(1);

    // 2) 相邻两个 id 既非递增也非递减的稳定规律:统计字典序方向,
    //    顺序枚举(如计数器)会让方向高度一致;密码学随机应接近五五开。
    let ascending = 0;
    for (let i = 1; i < bodies.length; i++) {
      if ((bodies[i] as string) > (bodies[i - 1] as string)) ascending++;
    }
    const ratio = ascending / (bodies.length - 1);
    // 容许统计抖动,但顺序枚举会逼近 0 或 1;此处要求落在中间带。
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.8);

    // 3) 不存在「下一个 = 上一个 +1」式的可预测衔接:相邻 id 不相等且无公共长前缀主导。
    for (let i = 1; i < bodies.length; i++) {
      expect(bodies[i]).not.toBe(bodies[i - 1]);
    }
  });
});

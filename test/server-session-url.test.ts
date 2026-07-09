/**
 * 会话删除的映射清理边界(spec vite-spa-migration,Req 1.3/1.4)。
 *
 * 只有**整会话删除**才丢弃 `sessionId → source` 映射;子资源删除(多余路径段)绝不触发,
 * 否则删一个附件就会让该会话的 webext 扩展在刷新后消失。
 */
import { describe, expect, it } from "vitest";
import { wholeSessionIdFromUrl } from "@/server/session-url";

describe("wholeSessionIdFromUrl", () => {
  it("整会话删除路径 → 提取 id(Req 1.3)", () => {
    expect(wholeSessionIdFromUrl("http://h/api/sessions/abc-123")).toBe("abc-123");
  });

  it("尾部斜杠仍视为整会话路径", () => {
    expect(wholeSessionIdFromUrl("http://h/api/sessions/abc-123/")).toBe("abc-123");
  });

  it("百分号编码的 id 被解码", () => {
    expect(wholeSessionIdFromUrl("http://h/api/sessions/a%2Fb")).toBe("a/b");
  });

  it("子资源删除 → undefined(Req 1.4)", () => {
    expect(
      wholeSessionIdFromUrl("http://h/api/sessions/abc/attachments/att_1"),
    ).toBeUndefined();
    expect(wholeSessionIdFromUrl("http://h/api/sessions/abc/messages")).toBeUndefined();
  });

  it("集合路径(无 id)→ undefined", () => {
    expect(wholeSessionIdFromUrl("http://h/api/sessions")).toBeUndefined();
    expect(wholeSessionIdFromUrl("http://h/api/sessions/")).toBeUndefined();
  });

  it("查询参数不影响提取", () => {
    expect(wholeSessionIdFromUrl("http://h/api/sessions/xyz?force=1")).toBe("xyz");
  });

  it("非会话路径 → undefined", () => {
    expect(wholeSessionIdFromUrl("http://h/api/config/settings")).toBeUndefined();
  });
});

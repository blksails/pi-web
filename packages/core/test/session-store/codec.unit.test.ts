/**
 * codec 纯函数单测:桶/文件名编码、序列化往返、解析失败、版本归一(Req 2.2/5.1/5.5/9.x/10.1/10.2)。
 */
import { describe, expect, it } from "vitest";
import {
  bucketDirName,
  makeReadNormalizer,
  parseLine,
  serializeEntry,
  serializeHeader,
  sessionFileName,
} from "../../src/session-store/codec.js";
import {
  SessionEntryParseError,
  UnknownSessionVersionError,
  type MessageEntry,
  type SessionEntry,
  type SessionHeader,
} from "../../src/session-store/types.js";

describe("codec 桶/文件名编码(Req 10.1/10.2)", () => {
  it("bucketDirName 复刻 pi 规则:去首分隔符、/ \\ : → -、两侧 --", () => {
    expect(bucketDirName("/Users/me/proj")).toBe("--Users-me-proj--");
    // pi 仅剥首个分隔符,不剥盘符;C:\work\app → 与 pi 一致产出
    expect(bucketDirName("C:\\work\\app")).toBe("--C--work-app--");
  });

  it("sessionFileName 把 ISO 时间戳的 : . 换成 -,拼 _<id>.jsonl", () => {
    expect(sessionFileName("2026-01-02T03:04:05.678Z", "abc123")).toBe(
      "2026-01-02T03-04-05-678Z_abc123.jsonl",
    );
  });
});

describe("codec 序列化与解析(Req 5.1/5.5)", () => {
  it("header 往返", () => {
    const h: SessionHeader = { type: "session", id: "s1", version: 3, cwd: "/w", timestamp: "2026-01-01T00:00:00.000Z" };
    const parsed = parseLine(serializeHeader(h), 0);
    expect(parsed.type).toBe("session");
    expect(parsed).toMatchObject({ id: "s1", version: 3, cwd: "/w" });
  });

  it("entry 往返,缺省 parentId 归一为 null", () => {
    const e: SessionEntry = { type: "message", id: "e1", parentId: null, timestamp: "t", message: { role: "user" } };
    const parsed = parseLine(serializeEntry(e), 1, "s1");
    expect(parsed).toMatchObject({ type: "message", id: "e1", parentId: null });
  });

  it("非法 JSON 抛解析错误并带定位", () => {
    expect.assertions(2);
    try {
      parseLine("{not json", 7, "s1");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionEntryParseError);
      expect((err as SessionEntryParseError).detail.position).toBe(7);
    }
  });

  it("未知 entry type 抛解析错误", () => {
    expect(() => parseLine(JSON.stringify({ type: "bogus", id: "x", timestamp: "t" }), 2)).toThrow(
      SessionEntryParseError,
    );
  });

  it("非法 version 抛未知版本错误(Req 9.3)", () => {
    expect(() => parseLine(JSON.stringify({ type: "session", id: "s", version: 9, cwd: "/w", timestamp: "t" }), 0)).toThrow(
      UnknownSessionVersionError,
    );
  });
});

describe("codec 版本归一(Req 9.1/9.2)", () => {
  it("v3 归一器对已校验 entry 恒等", () => {
    const n = makeReadNormalizer(3);
    const e: SessionEntry = { type: "message", id: "e1", parentId: "p", timestamp: "t", message: { role: "user" } };
    expect(n(e, 1)).toBe(e);
  });

  it("v2 把 message 的 hookMessage 角色归一为 custom", () => {
    const n = makeReadNormalizer(2);
    const e: MessageEntry = { type: "message", id: "e1", parentId: null, timestamp: "t", message: { role: "hookMessage", content: "x" } };
    const out = n(e, 1) as MessageEntry;
    expect(out.message.role).toBe("custom");
    expect(out.message["content"]).toBe("x");
  });

  it("v1 真实数据(无 id)按行号合成 id 与 parentId 链", () => {
    const n = makeReadNormalizer(1);
    // 真实 v1 entry 没有 id/parentId 字段
    const a = n({ type: "message", timestamp: "t", message: { role: "user" } }, 1);
    const b = n({ type: "message", timestamp: "t", message: { role: "user" } }, 2);
    const c = n({ type: "message", timestamp: "t", message: { role: "user" } }, 3);
    expect(a.id).toBe("v1-1");
    expect(a.parentId).toBe(null);
    expect(b.id).toBe("v1-2");
    expect(b.parentId).toBe("v1-1");
    expect(c.parentId).toBe("v1-2");
  });

  it("v1 compaction 的 firstKeptEntryIndex 转 firstKeptEntryId(行号 id)", () => {
    const n = makeReadNormalizer(1);
    n({ type: "message", timestamp: "t", message: { role: "user" } }, 1); // 行 1
    const comp = n({ type: "compaction", timestamp: "t", summary: "s", tokensBefore: 10, firstKeptEntryIndex: 1 }, 2);
    expect(comp.type).toBe("compaction");
    expect((comp as { firstKeptEntryId?: unknown }).firstKeptEntryId).toBe("v1-1");
    expect((comp as unknown as Record<string, unknown>)["firstKeptEntryIndex"]).toBeUndefined();
  });

  it("v1 hookMessage 角色也归一为 custom", () => {
    const n = makeReadNormalizer(1);
    const out = n({ type: "message", timestamp: "t", message: { role: "hookMessage" } }, 1) as MessageEntry;
    expect(out.message.role).toBe("custom");
  });
});

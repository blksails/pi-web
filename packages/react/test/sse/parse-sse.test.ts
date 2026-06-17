import { describe, it, expect } from "vitest";
import { parseSse } from "../../src/sse/parse-sse.js";

describe("parseSse", () => {
  it("parses a single data frame", () => {
    const { frames, rest } = parseSse('data: {"a":1}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('{"a":1}');
    expect(rest).toBe("");
  });

  it("parses id and event lines", () => {
    const { frames } = parseSse("id: 42\nevent: ping\ndata: hello\n\n");
    expect(frames[0]?.id).toBe("42");
    expect(frames[0]?.event).toBe("ping");
    expect(frames[0]?.data).toBe("hello");
  });

  it("merges multi-line data with \\n", () => {
    const { frames } = parseSse("data: line1\ndata: line2\n\n");
    expect(frames[0]?.data).toBe("line1\nline2");
  });

  it("strips trailing \\r (CRLF)", () => {
    const { frames } = parseSse("id: 7\r\ndata: x\r\n\r\n");
    expect(frames[0]?.id).toBe("7");
    expect(frames[0]?.data).toBe("x");
  });

  it("ignores comment / heartbeat lines", () => {
    const { frames } = parseSse(": heartbeat\n\ndata: real\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("real");
  });

  it("retains a half frame across chunks via rest", () => {
    const first = parseSse("data: {\"part\":");
    expect(first.frames).toHaveLength(0);
    expect(first.rest).toBe('data: {"part":');

    const combined = first.rest + '1}\n\n';
    const second = parseSse(combined);
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0]?.data).toBe('{"part":1}');
    expect(second.rest).toBe("");
  });

  it("splits two consecutive frames (uiMessageChunk + control style)", () => {
    const text =
      'id: 1\ndata: {"kind":"uiMessageChunk"}\n\n' +
      'id: 2\ndata: {"kind":"control"}\n\n';
    const { frames } = parseSse(text);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.id).toBe("1");
    expect(frames[1]?.id).toBe("2");
  });

  it("keeps the last unterminated frame as rest", () => {
    const { frames, rest } = parseSse("data: done\n\ndata: pending");
    expect(frames).toHaveLength(1);
    expect(rest).toBe("data: pending");
  });
});

/**
 * JsonlLineReader 成帧单元测试(Req 3.1–3.6, 7.1)。
 * 每条特殊字符/分片断言独立可见。
 */
import { describe, it, expect } from "vitest";
import { JsonlLineReader } from "../../src/rpc-channel/jsonl-reader.js";

const LS = " "; // LINE SEPARATOR
const PS = " "; // PARAGRAPH SEPARATOR

describe("JsonlLineReader — framing", () => {
  it("splits a single chunk with multiple newline-separated lines in order (Req 3.6)", () => {
    const r = new JsonlLineReader();
    const out = r.push('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("buffers an incomplete trailing fragment until completed by a later chunk (Req 3.3)", () => {
    const r = new JsonlLineReader();
    expect(r.push('{"a":1}\n{"par')).toEqual(['{"a":1}']);
    expect(r.push('tial":"')).toEqual([]);
    expect(r.push('value"}\n')).toEqual(['{"partial":"value"}']);
  });

  it("reassembles a JSON object split across many tiny chunks (Req 3.3)", () => {
    const r = new JsonlLineReader();
    const json = '{"type":"response","id":"x","success":true}';
    const all: string[] = [];
    for (const ch of (json + "\n").split("")) {
      all.push(...r.push(ch));
    }
    expect(all).toEqual([json]);
  });

  it("strips a trailing \\r from CRLF line endings (Req 3.2)", () => {
    const r = new JsonlLineReader();
    const out = r.push('{"a":1}\r\n{"b":2}\r\n');
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
    for (const line of out) expect(line.endsWith("\r")).toBe(false);
  });

  it("does NOT split on U+2028 inside a JSON string and preserves it (Req 3.4)", () => {
    const r = new JsonlLineReader();
    const lineWithLs = `{"text":"a${LS}b"}`;
    const out = r.push(lineWithLs + "\n");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(lineWithLs);
    expect(out[0]).toContain(LS);
    expect(JSON.parse(out[0]!).text).toBe(`a${LS}b`);
  });

  it("does NOT split on U+2029 inside a JSON string and preserves it (Req 3.4)", () => {
    const r = new JsonlLineReader();
    const lineWithPs = `{"text":"x${PS}y"}`;
    const out = r.push(lineWithPs + "\n");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(PS);
    expect(JSON.parse(out[0]!).text).toBe(`x${PS}y`);
  });

  it("treats U+2028/U+2029 as ordinary content even when spanning chunks (Req 3.4)", () => {
    const r = new JsonlLineReader();
    expect(r.push(`{"t":"a${LS}`)).toEqual([]);
    expect(r.push(`b${PS}c"}\n`)).toEqual([`{"t":"a${LS}b${PS}c"}`]);
  });

  it("skips blank lines (bare \\n and \\r\\n) without emitting or erroring (Req 3.5)", () => {
    const r = new JsonlLineReader();
    const out = r.push('{"a":1}\n\n\r\n{"b":2}\n');
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("emits nothing for a chunk with no newline and keeps it buffered", () => {
    const r = new JsonlLineReader();
    expect(r.push('{"incomplete":true}')).toEqual([]);
    expect(r.push("\n")).toEqual(['{"incomplete":true}']);
  });

  it("flush() returns a non-terminated trailing fragment once, then clears (Req 3.3 exit)", () => {
    const r = new JsonlLineReader();
    expect(r.push('{"a":1}\n{"trailing":true}')).toEqual(['{"a":1}']);
    expect(r.flush()).toEqual(['{"trailing":true}']);
    expect(r.flush()).toEqual([]);
  });

  it("flush() strips trailing \\r and skips an empty residual", () => {
    const r = new JsonlLineReader();
    r.push('{"x":1}\r');
    expect(r.flush()).toEqual(['{"x":1}']);

    const r2 = new JsonlLineReader();
    r2.push("\r");
    expect(r2.flush()).toEqual([]);
  });
});

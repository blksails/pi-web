/**
 * agent-slash-completion task 2.1:runner 装配期发送 slash_completions 帧。
 * 覆盖 Req 1.1、1.3(无声明不发帧;非空写单行合法 JSONL 帧)。
 */
import { describe, expect, it } from "vitest";
import { emitSlashCompletions } from "../../src/runner/slash-completions-wiring.js";

describe("emitSlashCompletions", () => {
  it("无声明 / 空声明:不写帧", () => {
    const lines: string[] = [];
    const write = (l: string): void => {
      lines.push(l);
    };
    emitSlashCompletions({}, write);
    emitSlashCompletions({ slashCompletions: [] }, write);
    expect(lines).toEqual([]);
  });

  it("非空声明:写单行合法 JSONL 帧", () => {
    const lines: string[] = [];
    emitSlashCompletions(
      { slashCompletions: [{ name: "img-gen", insertText: "/img-gen " }] },
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0] as string)).toEqual({
      type: "slash_completions",
      items: [{ name: "img-gen", insertText: "/img-gen " }],
    });
  });
});

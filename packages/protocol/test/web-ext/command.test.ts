import { describe, expect, it } from "vitest";
import {
  CommandExecutePayloadSchema,
  CommandResultSchema,
} from "../../src/web-ext/command.js";

describe("web-ext/command schema", () => {
  it("CommandExecutePayload:name 必填, argv 可选", () => {
    expect(CommandExecutePayloadSchema.safeParse({ name: "plugin" }).success).toBe(true);
    expect(
      CommandExecutePayloadSchema.safeParse({ name: "plugin", argv: "install local:/x" }).success,
    ).toBe(true);
    expect(CommandExecutePayloadSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CommandExecutePayloadSchema.safeParse({ argv: "x" }).success).toBe(false);
  });

  it("CommandResult:command 必填, effect 限枚举", () => {
    expect(
      CommandResultSchema.safeParse({ command: "plugin", effect: "panel-refresh" }).success,
    ).toBe(true);
    expect(CommandResultSchema.safeParse({ command: "plugin" }).success).toBe(true);
    expect(
      CommandResultSchema.safeParse({ command: "plugin", effect: "bogus" }).success,
    ).toBe(false);
  });
});

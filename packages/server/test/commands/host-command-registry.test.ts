import { describe, expect, it } from "vitest";
import { createHostCommandRegistry } from "../../src/commands/host-command-registry.js";
import type { HostCommandContext } from "../../src/commands/host-command-registry.js";

const ctx = { session: {} as never, argv: "" } satisfies HostCommandContext;

describe("createHostCommandRegistry", () => {
  it("has 命中已注册命令", () => {
    const reg = createHostCommandRegistry([
      { name: "plugin", execute: async () => ({ command: "plugin" }) },
    ]);
    expect(reg.has("plugin")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("execute 转发到对应执行器并返回其结果", async () => {
    const reg = createHostCommandRegistry([
      {
        name: "plugin",
        execute: async () => ({ command: "plugin", effect: "panel-refresh" }),
      },
    ]);
    const r = await reg.execute("plugin", ctx);
    expect(r).toEqual({ command: "plugin", effect: "panel-refresh" });
  });

  it("未注册命令返回 notify 失败结果(不抛)", async () => {
    const reg = createHostCommandRegistry([]);
    const r = await reg.execute("ghost", ctx);
    expect(r.effect).toBe("notify");
    expect(r.message).toContain("ghost");
  });

  it("执行器抛错被捕获为 notify + message(不崩)", async () => {
    const reg = createHostCommandRegistry([
      {
        name: "boom",
        execute: async () => {
          throw new Error("装炸了");
        },
      },
    ]);
    const r = await reg.execute("boom", ctx);
    expect(r.effect).toBe("notify");
    expect(r.message).toBe("装炸了");
  });
});

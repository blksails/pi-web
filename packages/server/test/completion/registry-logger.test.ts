/**
 * Task 4.2 — registry 默认 warn 钩子改走 @blksails/pi-web-logger (core:completion)。
 *
 * TDD 行为断言：
 * 1. 默认（无注入 onWarn）：同 id 覆盖时，warn 经 logger（core:completion）产出，
 *    不再直接调用 console.warn。
 * 2. 可注入覆盖（向后兼容）：注入 onWarn 时覆盖仍生效。
 * 3. 既有行为不变：触发符并集、单字符校验、register 抛错行为不受影响。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LogEntry, Sink } from "@blksails/pi-web-logger";
import { configureLogger } from "@blksails/pi-web-logger";
import { createCompletionRegistry } from "../../src/completion/registry.js";
import type { CompletionProvider } from "../../src/completion/types.js";

function prov(id: string, trigger = "@"): CompletionProvider {
  return {
    id,
    trigger,
    complete: async () => [],
  };
}

function makeSink(): { sink: Sink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const sink: Sink = (entry) => entries.push(entry);
  return { sink, entries };
}

beforeEach(() => {
  configureLogger({ enabled: true, level: "debug" });
});

afterEach(() => {
  configureLogger({ enabled: true, level: "debug", namespaces: {} });
});

describe("registry 默认 warn → logger(core:completion)", () => {
  it("无注入 onWarn 时，同 id 覆盖经 logger(core:completion) warn 产出", () => {
    const { sink, entries } = makeSink();
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // sink 注入到内部 logger，捕获 log entry 断言 namespace
    const reg = createCompletionRegistry({ loggerSink: sink });
    reg.register(prov("dup", "@"));
    reg.register(prov("dup", "@")); // triggers warn via logger

    const warnEntries = entries.filter(
      (e) => e.level === "warn" && e.ns === "core:completion",
    );
    expect(warnEntries.length).toBeGreaterThanOrEqual(1);
    expect(warnEntries[0]?.msg).toContain("dup");

    // console.warn 不应被 registry 默认路径直接调用
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("可注入 onWarn 覆盖仍生效（向后兼容）", () => {
    const customWarnCalls: string[] = [];
    const reg = createCompletionRegistry({
      onWarn: (msg) => customWarnCalls.push(msg),
    });

    reg.register(prov("dup", "@"));
    reg.register(prov("dup", "@")); // triggers onWarn override

    expect(customWarnCalls.length).toBe(1);
    expect(customWarnCalls[0]).toContain("dup");
  });

  it("单字符校验抛错行为不受影响", () => {
    const reg = createCompletionRegistry();
    expect(() => reg.register(prov("bad", "@@"))).toThrow();
  });

  it("触发符并集不受影响", () => {
    const reg = createCompletionRegistry();
    reg.register(prov("file", "@"));
    reg.register(prov("env", "$"));
    const triggers = reg.triggers().map((t) => t.trigger).sort();
    expect(triggers).toEqual(["$", "@"]);
  });
});

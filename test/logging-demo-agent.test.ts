/**
 * logging-demo-agent 结构与契约测试（任务 5.4）。
 *
 * 覆盖:
 *  - demo agent factory 能被加载器解析并返回 AgentDefinition（shape-b 工厂验证）
 *  - extension 文件存在且可被 TypeScript 校验（结构/契约层面）
 *  - factory 接受含 logger 的 AgentContext 并正确返回定义
 *
 * Requirements: 2.1, 2.3
 */
import { describe, it, expect, vi } from "vitest";
import type { AgentContext } from "@pi-web/agent-kit";
import type { Logger } from "@pi-web/logger";

// We import the demo agent factory directly; jiti/ts-node loads the TS file.
// Vitest uses vite-plugin-runner which handles TypeScript natively.
import demoAgentFactory from "../examples/logging-demo-agent/index.js";

/** Build a minimal AgentContext with a spy logger for testing. */
function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as Logger),
  };
  return {
    cwd: "/tmp/logging-demo-agent",
    env: {},
    logger,
    ...overrides,
  };
}

describe("logging-demo-agent factory (shape-b)", () => {
  it("default export is a function (shape-b factory)", () => {
    expect(typeof demoAgentFactory).toBe("function");
  });

  it("factory returns an AgentDefinition object with at least systemPrompt", () => {
    const ctx = makeCtx();
    const def = demoAgentFactory(ctx);
    expect(def).toBeDefined();
    expect(typeof def).toBe("object");
    expect(def).not.toBeNull();
    expect(typeof def.systemPrompt).toBe("string");
    expect((def.systemPrompt as string).length).toBeGreaterThan(0);
  });

  it("factory calls ctx.logger at multiple levels on startup", () => {
    const ctx = makeCtx();
    const logger = ctx.logger!;
    demoAgentFactory(ctx);
    // Should have emitted debug/info/warn/error during factory invocation.
    expect(vi.mocked(logger.debug)).toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it("factory calls logger.child to create a scoped child logger", () => {
    const ctx = makeCtx();
    const logger = ctx.logger!;
    demoAgentFactory(ctx);
    expect(vi.mocked(logger.child)).toHaveBeenCalledWith("tool");
  });

  it("factory works without a logger (ctx.logger undefined)", () => {
    const ctx = makeCtx({ logger: undefined });
    // Should not throw when logger is absent.
    expect(() => demoAgentFactory(ctx)).not.toThrow();
  });

  it("returned definition includes noTools='builtin' to disable built-in tools", () => {
    const ctx = makeCtx();
    const def = demoAgentFactory(ctx);
    expect(def.noTools).toBe("builtin");
  });
});

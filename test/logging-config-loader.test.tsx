/**
 * LoggingConfigLoader（任务 3.4）：configureLogger 接线测试。
 *
 * 覆盖 requirements:
 *  - Req 6.4 — 加载配置后 configureLogger 被以 enabled 字段调用
 *  - Req 6.5 — configureLogger 被以 namespaces 字段调用
 *  - Req 6.6 — configureLogger 被以 level 字段调用
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Mock configureLogger from @blksails/pi-web-logger.
const mockConfigureLogger = vi.fn();
vi.mock("@blksails/pi-web-logger", () => ({
  configureLogger: (args: unknown) => mockConfigureLogger(args),
}));

// Mock fetch to return a logging config.
function mockFetch(config: {
  enabled?: boolean;
  level?: string;
  namespaces?: Record<string, boolean>;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ values: config }),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LoggingConfigLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mount 时调用 configureLogger 含 enabled=false（Req 6.4）", async () => {
    mockFetch({ enabled: false });
    const { LoggingConfigLoader } = await import(
      "@/components/logging-config-loader"
    );
    render(<LoggingConfigLoader />);
    // Wait for async effect.
    await vi.waitFor(() => {
      expect(mockConfigureLogger).toHaveBeenCalled();
    });
    const arg = mockConfigureLogger.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.enabled).toBe(false);
  });

  it("mount 时调用 configureLogger 含 level（Req 6.6）", async () => {
    mockFetch({ level: "warn" });
    const { LoggingConfigLoader } = await import(
      "@/components/logging-config-loader"
    );
    render(<LoggingConfigLoader />);
    await vi.waitFor(() => {
      expect(mockConfigureLogger).toHaveBeenCalled();
    });
    const arg = mockConfigureLogger.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.level).toBe("warn");
  });

  it("mount 时调用 configureLogger 含 namespaces（Req 6.5）", async () => {
    mockFetch({ namespaces: { "agent:tool": true, "agent:http": false } });
    const { LoggingConfigLoader } = await import(
      "@/components/logging-config-loader"
    );
    render(<LoggingConfigLoader />);
    await vi.waitFor(() => {
      expect(mockConfigureLogger).toHaveBeenCalled();
    });
    const arg = mockConfigureLogger.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.namespaces).toEqual({ "agent:tool": true, "agent:http": false });
  });

  it("fetch 失败时静默不抛出", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { LoggingConfigLoader } = await import(
      "@/components/logging-config-loader"
    );
    // Should not throw.
    expect(() => render(<LoggingConfigLoader />)).not.toThrow();
    // Wait a tick for the async effect to settle without throwing.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockConfigureLogger).not.toHaveBeenCalled();
  });
});

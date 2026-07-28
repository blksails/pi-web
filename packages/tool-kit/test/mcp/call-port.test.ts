import { describe, expect, it, vi } from "vitest";
import {
  createMcpCallPort,
  disposeMcpCallPort,
  getMcpCallPort,
  installMcpCallPort,
} from "../../src/mcp/call-port.js";
import type { McpServerHandle } from "../../src/mcp/client-manager.js";

function handle(
  callTool: McpServerHandle["callTool"] = vi.fn(async () => ({ content: [] })),
): McpServerHandle {
  return {
    serverName: "test",
    tools: [{ name: "echo", inputSchema: { type: "object" } }],
    callTool,
  };
}

describe("McpCallPort", () => {
  it("seam 未安装时稳定降级", async () => {
    const result = await getMcpCallPort({}).call({
      serverName: "test",
      toolName: "echo",
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "mcp_unavailable", message: "MCP capability unavailable." },
    });
  });

  it("按 server/tool 调同一 handle", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const port = createMcpCallPort((name) => (name === "test" ? handle(callTool) : undefined));
    const result = await port.call({
      serverName: "test",
      toolName: "echo",
      args: { text: "hi" },
    });
    expect(result.ok).toBe(true);
    expect(callTool).toHaveBeenCalledWith("echo", { text: "hi" }, undefined);
  });

  it("缺 server / tool 与调用异常皆返回稳定错误且不泄露底层 message", async () => {
    const noServer = createMcpCallPort(() => undefined);
    expect(
      await noServer.call({ serverName: "missing", toolName: "echo" }),
    ).toMatchObject({ ok: false, error: { code: "mcp_server_unavailable" } });

    const noTool = createMcpCallPort(() => handle());
    expect(
      await noTool.call({ serverName: "test", toolName: "missing" }),
    ).toMatchObject({ ok: false, error: { code: "mcp_tool_unavailable" } });

    const failed = createMcpCallPort(() =>
      handle(vi.fn(async () => {
        throw new Error("Bearer secret-value");
      })),
    );
    const result = await failed.call({ serverName: "test", toolName: "echo" });
    expect(result).toMatchObject({ ok: false, error: { code: "mcp_call_failed" } });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("安装后懒取可见，dispose 清理幂等", async () => {
    const scope: Record<string, unknown> = {};
    const cleanup = vi.fn(async () => undefined);
    const installation = installMcpCallPort(createMcpCallPort(() => handle()), cleanup, scope);

    expect(
      await getMcpCallPort(scope).call({ serverName: "test", toolName: "echo" }),
    ).toMatchObject({ ok: true });

    await installation.cleanup();
    await installation.cleanup();
    await disposeMcpCallPort(scope);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(
      await getMcpCallPort(scope).call({ serverName: "test", toolName: "echo" }),
    ).toMatchObject({ ok: false, error: { code: "mcp_unavailable" } });
  });

  it("取消与超时返回稳定错误码", async () => {
    const waiting = createMcpCallPort(() =>
      handle((_tool: string, _args: unknown, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          if (signal?.aborted === true) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      await waiting.call({
        serverName: "test",
        toolName: "echo",
        signal: controller.signal,
      }),
    ).toMatchObject({ ok: false, error: { code: "mcp_cancelled" } });
    expect(
      await waiting.call({
        serverName: "test",
        toolName: "echo",
        timeoutMs: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "mcp_timeout" } });
  });

  it("runner 侧 dispose 触发当前安装的 cleanup", async () => {
    const scope: Record<string, unknown> = {};
    const cleanup = vi.fn(async () => undefined);
    installMcpCallPort(createMcpCallPort(() => handle()), cleanup, scope);
    await disposeMcpCallPort(scope);
    await disposeMcpCallPort(scope);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

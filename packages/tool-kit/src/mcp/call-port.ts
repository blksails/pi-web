import type { McpServerHandle } from "./client-manager.js";
import type { McpToolCallResult } from "./tool-adapter.js";

export const MCP_CALL_PORT_SEAM_KEY = "__piWebMcpCallPort__";

export interface McpCallInput {
  readonly serverName: string;
  readonly toolName: string;
  readonly args?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type McpCallResult =
  | { readonly ok: true; readonly result: McpToolCallResult }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "mcp_unavailable"
          | "mcp_server_unavailable"
          | "mcp_tool_unavailable"
          | "mcp_cancelled"
          | "mcp_timeout"
          | "mcp_call_failed";
        readonly message: string;
      };
    };

export interface McpCallPort {
  call(input: McpCallInput): Promise<McpCallResult>;
}

interface InstalledPort {
  readonly __piWebMcpCallPort: true;
  readonly port: McpCallPort;
  readonly cleanup?: () => void | Promise<void>;
}

export interface McpCallPortInstallation {
  cleanup(): Promise<void>;
}

const unavailable: McpCallPort = {
  async call() {
    return {
      ok: false,
      error: { code: "mcp_unavailable", message: "MCP capability unavailable." },
    };
  },
};

function target(scope?: Record<string, unknown>): Record<string, unknown> {
  return scope ?? (globalThis as unknown as Record<string, unknown>);
}

function installed(value: unknown): value is InstalledPort {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __piWebMcpCallPort?: unknown }).__piWebMcpCallPort === true &&
    typeof (value as { port?: { call?: unknown } }).port?.call === "function"
  );
}

export function createMcpCallPort(
  resolveHandle: (serverName: string) => McpServerHandle | undefined,
): McpCallPort {
  return {
    async call(input) {
      const handle = resolveHandle(input.serverName);
      if (handle === undefined) {
        return {
          ok: false,
          error: {
            code: "mcp_server_unavailable",
            message: `MCP server "${input.serverName}" is unavailable.`,
          },
        };
      }
      if (!handle.tools.some((tool) => tool.name === input.toolName)) {
        return {
          ok: false,
          error: {
            code: "mcp_tool_unavailable",
            message: `MCP tool "${input.serverName}/${input.toolName}" is unavailable.`,
          },
        };
      }
      const cancelled = (): boolean => input.signal?.aborted === true;
      if (cancelled()) {
        return {
          ok: false,
          error: {
            code: "mcp_cancelled",
            message: `MCP tool "${input.serverName}/${input.toolName}" failed.`,
          },
        };
      }
      const controller =
        input.signal !== undefined || input.timeoutMs !== undefined
          ? new AbortController()
          : undefined;
      const abort = (): void => controller?.abort(input.signal?.reason);
      input.signal?.addEventListener("abort", abort, { once: true });
      const timer =
        input.timeoutMs !== undefined
          ? setTimeout(() => controller?.abort(), input.timeoutMs)
          : undefined;
      try {
        return {
          ok: true,
          result: await handle.callTool(
            input.toolName,
            input.args,
            controller?.signal ?? input.signal,
          ),
        };
      } catch {
        const code =
          cancelled()
            ? "mcp_cancelled"
            : controller?.signal.aborted === true
              ? "mcp_timeout"
              : "mcp_call_failed";
        return {
          ok: false,
          error: {
            code,
            message: `MCP tool "${input.serverName}/${input.toolName}" failed.`,
          },
        };
      } finally {
        input.signal?.removeEventListener("abort", abort);
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

export function getMcpCallPort(scope?: Record<string, unknown>): McpCallPort {
  const value = target(scope)[MCP_CALL_PORT_SEAM_KEY];
  return installed(value) ? value.port : unavailable;
}

export function installMcpCallPort(
  port: McpCallPort,
  cleanup?: () => void | Promise<void>,
  scope?: Record<string, unknown>,
): McpCallPortInstallation {
  const host = target(scope);
  const slot: InstalledPort = { __piWebMcpCallPort: true, port, cleanup };
  host[MCP_CALL_PORT_SEAM_KEY] = slot;
  let cleaned = false;
  return {
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (host[MCP_CALL_PORT_SEAM_KEY] === slot) {
        delete host[MCP_CALL_PORT_SEAM_KEY];
      }
      await cleanup?.();
    },
  };
}

export async function disposeMcpCallPort(
  scope?: Record<string, unknown>,
): Promise<void> {
  const host = target(scope);
  const value = host[MCP_CALL_PORT_SEAM_KEY];
  if (!installed(value)) return;
  delete host[MCP_CALL_PORT_SEAM_KEY];
  await value.cleanup?.();
}

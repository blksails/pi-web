/**
 * runner 侧的 mcp.json 读取(spec: builtin-mcp-client,任务 2.4)。
 *
 * 与主进程共享 protocol 侧的 `normalizeMcpConfig`,确保两侧对同一份文件的理解一致
 * (键位置、旧格式兼容、未识别保留的判定完全同源)。
 *
 * 读失败/文件缺失/内容损坏一律降级为空配置并**不抛出** —— MCP 不可用绝不能阻塞会话装配
 * (Req 1.5 的降级方向)。
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeMcpConfig, type NormalizedMcpConfig } from "@blksails/pi-web-protocol";

export const MCP_CONFIG_FILENAME = "mcp.json";

/** 与 protocol 侧 per-source codec 同款解析:env 优先,否则 `~/.pi/agent`。 */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

export function mcpConfigPath(agentDir?: string): string {
  return join(agentDir ?? resolveAgentDir(), MCP_CONFIG_FILENAME);
}

/** 读取并规范化;任何失败都降级为空配置。 */
export async function loadMcpConfig(agentDir?: string): Promise<NormalizedMcpConfig> {
  try {
    const text = await fs.readFile(mcpConfigPath(agentDir), "utf8");
    return normalizeMcpConfig(JSON.parse(text));
  } catch {
    return normalizeMcpConfig(undefined);
  }
}

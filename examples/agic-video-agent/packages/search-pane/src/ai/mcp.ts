import {
  createSearchToolDefinitions,
  type SearchToolDefinition,
} from "./tools.js";
import type { SearchPlatformClient } from "../platform.js";

/** 传输无关 MCP 适配；MCP server 与进程内 CustomTools 共用同一 schema/执行器。 */
export function createSearchMcpTools(
  client?: SearchPlatformClient,
): readonly SearchToolDefinition[] {
  return createSearchToolDefinitions(client);
}

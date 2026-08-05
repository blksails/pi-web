import {
  createMaterialsToolDefinitions,
  type MaterialsToolDefinition,
} from "./tools.js";
import type { MaterialsApplicationService } from "../application/index.js";

/**
 * 传输无关 MCP 适配：MCP server 直接注册这些定义；schema 与 CustomTools 同源。
 * 本包不另起第二个 MCP transport，现有 pi-labs MCP 只需消费此清单。
 */
export function createMaterialsMcpTools(
  service?: MaterialsApplicationService,
): readonly MaterialsToolDefinition[] {
  return createMaterialsToolDefinitions(service);
}

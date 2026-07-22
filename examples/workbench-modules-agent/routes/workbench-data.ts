import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import {
  mutateWorkbench,
  readWorkbenchModule,
  type WorkbenchModuleId,
} from "../workbench-state.js";

const MODULES = new Set<WorkbenchModuleId>(["files", "editor", "diff", "canvas"]);

export function workbenchDataHandler(req: AgentRouteRequest): unknown {
  if (req.method === "POST") return mutateWorkbench(req.body);
  const moduleId = req.query["module"] as WorkbenchModuleId | undefined;
  if (moduleId === undefined || !MODULES.has(moduleId)) {
    return { ok: false, error: "query.module must name a workbench module" };
  }
  return { ok: true, data: readWorkbenchModule(moduleId, req.query) };
}

export const workbenchDataRoute: AgentRouteDecl = {
  name: "workbench-data",
  methods: ["GET", "POST"],
  description: "Workbench 模块的最小读写数据面",
  handler: workbenchDataHandler,
};

import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import {
  mutatePanes,
  readPane,
  type PaneId,
} from "../panes-state.js";

const PANES = new Set<PaneId>(["files", "editor", "diff", "canvas", "artifact"]);

export function paneDataHandler(req: AgentRouteRequest): unknown {
  if (req.method === "POST") return mutatePanes(req.body);
  const paneId = req.query["pane"] as PaneId | undefined;
  if (paneId === undefined || !PANES.has(paneId)) {
    return { ok: false, error: "query.pane must name a declared pane" };
  }
  return { ok: true, data: readPane(paneId, req.query) };
}

export const paneDataRoute: AgentRouteDecl = {
  name: "pane-data",
  methods: ["GET", "POST"],
  description: "隔离 Pane 的会话内读写数据面",
  handler: paneDataHandler,
};

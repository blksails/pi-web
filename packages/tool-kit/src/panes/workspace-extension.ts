/**
 * panes 工作区 LLM 遥控(agent 侧)：surface domain `panes-workspace` + 基础 pane 工具。
 *
 * 对偶端是 `@blksails/pi-web-panes-kit` React `PanesHost` 内置的 workspace bridge
 * (见 panes-kit `workspace-protocol.ts`)：
 *  - 下行：本扩展把 LLM 意图追加进快照 `ops`(单调 opId、窗口截断)，宿主增量应用；
 *  - 上行：宿主经 surface 命令 `report` 回声实况(pane 目录/实例/激活态)，写回快照
 *    `report` 字段并唤醒等待回声的写工具(有界等待，默认 5s)。
 *
 * 注册工具：`pane_list` / `pane_open` / `pane_activate` / `pane_close` / `pane_reload`。
 * 属 runtime 层(pi SDK 值导入)，仅经 `@blksails/pi-web-tool-kit/runtime` 加载。
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  PANES_WORKSPACE_DOMAIN,
  PANES_WORKSPACE_OPS_WINDOW,
  PANES_WORKSPACE_REPORT_ACTION,
  PaneWorkspaceReportSchema,
  type PaneWorkspaceOp,
  type PaneWorkspaceReport,
  type PanesWorkspaceSnapshot,
} from "@blksails/pi-web-panes-kit/workspace-protocol";
import { createSurface, type CreateSurfaceDeps } from "../surface/create-surface.js";

export interface PanesWorkspaceExtensionOptions {
  /** surface domain(默认 `panes-workspace`;须与宿主 `PanesHost` 的 `workspaceDomain` 一致)。 */
  domain?: string;
  /** 写工具等待 UI 回声的上限毫秒(默认 5000;0 = 不等待,发完即返回)。 */
  reportTimeoutMs?: number;
  /** 测试注入(透传 createSurface)。 */
  surfaceDeps?: CreateSurfaceDeps;
}

interface ToolText {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
}

function textResult(value: unknown): ToolText {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: undefined };
}

function optionalId(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const NO_REPORT_HINT =
  "尚未收到 UI 回声——面板可能未打开、未连接,或宿主未启用 workspace bridge。稍后用 pane_list 复查。";

export function makePanesWorkspaceExtension(
  options: PanesWorkspaceExtensionOptions = {},
): (pi: ExtensionAPI) => void {
  return function panesWorkspaceExtension(pi: ExtensionAPI): void {
    const domain = options.domain ?? PANES_WORKSPACE_DOMAIN;
    const timeoutMs = options.reportTimeoutMs ?? 5_000;

    let nextOpId = 1;
    let lastReport: PaneWorkspaceReport | undefined;
    let pendingOps: readonly PaneWorkspaceOp[] = [];
    const waiters = new Map<number, (report: PaneWorkspaceReport) => void>();

    const handle = createSurface<PanesWorkspaceSnapshot>(pi, {
      domain,
      initialState: { revision: 0, ops: [] },
      commands: {
        [PANES_WORKSPACE_REPORT_ACTION]: (args, ctx) => {
          const parsed = PaneWorkspaceReportSchema.safeParse(args);
          if (!parsed.success) {
            return { ok: false as const, error: { code: "invalid_report", message: "report payload does not match workspace protocol" } };
          }
          const report = parsed.data;
          lastReport = report;
          pendingOps = pendingOps.filter((op) => op.opId > report.appliedOpId);
          ctx.setState((prev) => ({ ...prev, revision: prev.revision + 1, report }));
          for (const [opId, resolve] of [...waiters]) {
            if (opId <= report.appliedOpId) {
              waiters.delete(opId);
              resolve(report);
            }
          }
          return { appliedOpId: report.appliedOpId };
        },
      },
    }, options.surfaceDeps);

    const pushOp = (make: (opId: number) => PaneWorkspaceOp): number => {
      const opId = nextOpId++;
      const op = make(opId);
      pendingOps = [...pendingOps, op].slice(-PANES_WORKSPACE_OPS_WINDOW);
      handle.update((prev) => ({
        ...prev,
        revision: prev.revision + 1,
        ops: [...prev.ops, op].slice(-PANES_WORKSPACE_OPS_WINDOW),
      }));
      return opId;
    };

    const awaitReport = (opId: number): Promise<PaneWorkspaceReport | undefined> => {
      if (timeoutMs <= 0) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(opId);
          resolve(undefined);
        }, timeoutMs);
        waiters.set(opId, (report) => {
          clearTimeout(timer);
          resolve(report);
        });
      });
    };

    const applyResult = (opId: number, report: PaneWorkspaceReport | undefined): ToolText =>
      textResult(report === undefined
        ? { opId, applied: false, note: NO_REPORT_HINT }
        : { opId, applied: true, workspace: report });

    pi.registerTool({
      name: "pane_list",
      label: "List panes",
      description:
        "List the isolated panes workspace: openable pane catalog (paneId, quota), live instances and the active tab. " +
        "Reads the latest UI echo; call this before pane_open/pane_activate/pane_close to discover ids.",
      parameters: Type.Object({}),
      async execute() {
        return textResult(lastReport === undefined
          ? { connected: false, note: NO_REPORT_HINT, pendingOpIds: pendingOps.map((op) => op.opId) }
          : { connected: true, workspace: lastReport, pendingOpIds: pendingOps.map((op) => op.opId) });
      },
    });

    pi.registerTool({
      name: "pane_open",
      label: "Open pane",
      description:
        "Open a new tab (isolated pane instance) in the panes workspace and focus it. " +
        "paneId comes from pane_list panes[].paneId; quota (maxInstances/maxOpenPanes) is enforced by the host.",
      parameters: Type.Object({
        paneId: Type.String({ description: "Pane id from pane_list panes[].paneId" }),
      }),
      async execute(_id, params: Record<string, unknown>) {
        const paneId = optionalId(params, "paneId");
        if (paneId === undefined) return textResult({ ok: false, error: "paneId is required" });
        const opId = pushOp((id) => ({ opId: id, type: "open", paneId }));
        return applyResult(opId, await awaitReport(opId));
      },
    });

    const targetParams = Type.Object({
      instanceId: Type.Optional(Type.String({ description: "Exact instance id from pane_list instances[].instanceId" })),
      paneId: Type.Optional(Type.String({ description: "Convenience: targets the first open instance of this pane" })),
    });

    const targetTool = (
      name: string,
      label: string,
      description: string,
      type: "activate" | "close" | "reload",
    ): void => {
      pi.registerTool({
        name,
        label,
        description,
        parameters: targetParams,
        async execute(_id, params: Record<string, unknown>) {
          const instanceId = optionalId(params, "instanceId");
          const paneId = optionalId(params, "paneId");
          if (instanceId === undefined && paneId === undefined) {
            return textResult({ ok: false, error: "instanceId or paneId is required" });
          }
          const opId = pushOp((id) => ({ opId: id, type, instanceId, paneId }));
          return applyResult(opId, await awaitReport(opId));
        },
      });
    };

    targetTool(
      "pane_activate",
      "Activate pane",
      "Focus (bring to front) an open pane tab in the panes workspace.",
      "activate",
    );
    targetTool(
      "pane_close",
      "Close pane",
      "Close an open pane tab in the panes workspace. The instance and its iframe are disposed.",
      "close",
    );
    targetTool(
      "pane_reload",
      "Reload pane",
      "Reload an open pane tab (new epoch, fresh iframe realm). Use to recover a failed pane.",
      "reload",
    );
  };
}

/** 默认配置的 panes 工作区扩展(domain=`panes-workspace`,回声等待 5s)。 */
export const panesWorkspaceExtension = makePanesWorkspaceExtension();

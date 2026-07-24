import type { PaneDefinition, PaneInstance, PanesDefinition } from "./contract.js";

export interface PaneWorkspaceState {
  readonly instances: readonly PaneInstance[];
  readonly activeInstanceId?: string;
}

export type PaneWorkspaceAction =
  | { readonly type: "open"; readonly paneId: string; readonly instanceId: string }
  | { readonly type: "activate"; readonly instanceId: string }
  | { readonly type: "close"; readonly instanceId: string }
  | { readonly type: "reload"; readonly instanceId: string }
  | { readonly type: "move"; readonly instanceId: string; readonly beforeInstanceId: string };

function paneById(definition: PanesDefinition, paneId: string): PaneDefinition {
  const pane = definition.panes.find((candidate) => candidate.id === paneId);
  if (pane === undefined) throw new Error(`Unknown pane id: ${paneId}`);
  return pane;
}

export function createPaneWorkspace(
  definition: PanesDefinition,
  idFactory: (paneId: string, index: number) => string,
): PaneWorkspaceState {
  const initial = definition.initialPaneIds ?? [definition.panes[0]!.id];
  const instances = initial.map((paneId, index): PaneInstance => ({
    instanceId: idFactory(paneId, index),
    paneId: paneById(definition, paneId).id,
    epoch: 1,
    state: index === 0 ? "connecting" : "hidden",
  }));
  return { instances, activeInstanceId: instances[0]?.instanceId };
}

export function reducePaneWorkspace(
  definition: PanesDefinition,
  state: PaneWorkspaceState,
  action: PaneWorkspaceAction,
): PaneWorkspaceState {
  if (action.type === "open") {
    const pane = paneById(definition, action.paneId);
    const existing = state.instances.filter((instance) => instance.paneId === pane.id);
    if (!pane.allowMultiple && existing[0] !== undefined) {
      return reducePaneWorkspace(definition, state, { type: "activate", instanceId: existing[0].instanceId });
    }
    if (existing.length >= pane.maxInstances || state.instances.length >= definition.maxOpenPanes) return state;
    const instances = state.instances.map((instance) => ({
      ...instance,
      state: instance.state === "disposed" ? "disposed" as const : "hidden" as const,
    }));
    return {
      instances: [...instances, { instanceId: action.instanceId, paneId: pane.id, epoch: 1, state: "connecting" }],
      activeInstanceId: action.instanceId,
    };
  }
  if (action.type === "activate") {
    if (!state.instances.some((instance) => instance.instanceId === action.instanceId)) return state;
    return {
      instances: state.instances.map((instance) => ({
        ...instance,
        state: instance.instanceId === action.instanceId
          ? (instance.state === "failed" ? "failed" : "ready")
          : (instance.state === "disposed" ? "disposed" : "hidden"),
      })),
      activeInstanceId: action.instanceId,
    };
  }
  if (action.type === "close") {
    const index = state.instances.findIndex((instance) => instance.instanceId === action.instanceId);
    if (index < 0) return state;
    const instances = state.instances.filter((instance) => instance.instanceId !== action.instanceId);
    if (state.activeInstanceId !== action.instanceId) return { ...state, instances };
    const next = instances[Math.min(index, Math.max(0, instances.length - 1))];
    return next === undefined
      ? { instances }
      : reducePaneWorkspace(definition, { instances }, { type: "activate", instanceId: next.instanceId });
  }
  if (action.type === "reload") {
    return {
      ...state,
      instances: state.instances.map((instance) => instance.instanceId === action.instanceId
        ? { ...instance, epoch: instance.epoch + 1, state: "connecting" }
        : instance),
    };
  }
  const from = state.instances.findIndex((instance) => instance.instanceId === action.instanceId);
  const to = state.instances.findIndex((instance) => instance.instanceId === action.beforeInstanceId);
  if (from < 0 || to < 0 || from === to) return state;
  const instances = [...state.instances];
  const [moved] = instances.splice(from, 1);
  if (moved === undefined) return state;
  const target = instances.findIndex((instance) => instance.instanceId === action.beforeInstanceId);
  instances.splice(target, 0, moved);
  return { ...state, instances };
}

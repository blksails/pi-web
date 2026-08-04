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

export interface ReconcilePaneWorkspaceInput {
  /** 当前(可能已补齐的)pane 清单。 */
  readonly definition: PanesDefinition;
  /** 当前已打开集合。 */
  readonly state: PaneWorkspaceState;
  /**
   * 上次写快照时 definition 已知的全部 pane id。
   *
   * `undefined` 表示无从判断(旧格式快照,或本会话尚未写过快照)——此时不推导用户意图,
   * 仅补开「初始集合中尚未打开」的 pane。该窗口只存在于尚未写出新格式快照的首个会话。
   */
  readonly knownPaneIds: readonly string[] | undefined;
  /** 生成新 instance 的 id 工厂(与 {@link createPaneWorkspace} 同形)。 */
  readonly idFactory: (paneId: string) => string;
}

/**
 * pane 清单变化后,把「新出现且声明为初始打开」的 pane 补进已打开集合。
 *
 * ## 为什么需要它
 *
 * workspace 由 `useState` 惰性初始化建立,只在首次 mount 跑一次。清单异步补齐(webext 经在线
 * 解析装载)时,首帧只有宿主内置 pane,workspace 就此定型且被写入持久化快照,下次读回还能通过
 * 校验 —— agent 声明的 pane 从此永远打不开。
 *
 * ## 用户意图从哪里来
 *
 * 快照只记「当前打开了哪些」,**结构上分不出**「用户主动关掉的」与「因清单不完整而没来得及打开的」。
 * 故快照另记 `knownPaneIds`(写盘当时清单里的全部 pane):
 *
 *   knownPaneIds − 已打开 = 用户见过却选择不开 → 必须尊重,不补
 *   当前清单 − knownPaneIds = 写快照时还不知道 → 属初始集合者补开
 *
 * ## 只增不减
 *
 * 绝不关闭、移除或重排既有 instance。`instanceId` 是桌面原生 WebView 的 label 种子
 * (见 `PersistedPaneWorkspace.instanceIds`),重建它会让桌面形态下的 WebView 被销毁重建 ——
 * 这正是「definition 变了就整体重建 workspace」那个更直觉的方案被否决的原因。
 *
 * 无可补开时返回**入参 state 本身**(引用相等),调用方据此跳过 setState,避免无谓重渲染。
 */
export function reconcilePaneWorkspace(input: ReconcilePaneWorkspaceInput): PaneWorkspaceState {
  const { definition, state, knownPaneIds, idFactory } = input;
  const initial = definition.initialPaneIds;
  if (initial === undefined || initial.length === 0) return state;

  const openPaneIds = new Set(state.instances.map((instance) => instance.paneId));
  const closedByUser = knownPaneIds === undefined
    ? undefined
    : new Set(knownPaneIds.filter((paneId) => !openPaneIds.has(paneId)));
  const declared = new Set(definition.panes.map((pane) => pane.id));

  const candidates: string[] = [];
  for (const paneId of initial) {
    // 清单里已不存在的 / 已经打开的 / 用户关掉的 / initialPaneIds 内重复的,一律不补。
    if (!declared.has(paneId)) continue;
    if (openPaneIds.has(paneId)) continue;
    if (closedByUser?.has(paneId) === true) continue;
    if (candidates.includes(paneId)) continue;
    candidates.push(paneId);
  }
  if (candidates.length === 0) return state;

  // 上限只截 candidates 一侧:已经打开且用户可见的 instance 一个都不能因补齐而被挤掉。
  const room = definition.maxOpenPanes - state.instances.length;
  if (room <= 0) return state;

  const hasActive = state.activeInstanceId !== undefined;
  const appended = candidates.slice(0, room).map((paneId, index): PaneInstance => ({
    instanceId: idFactory(paneId),
    paneId: paneById(definition, paneId).id,
    epoch: 1,
    // 补开不夺焦点:已有活跃实例时新实例一律 hidden。原本空空如也时(例如清单迟到且
    // 首帧连内置 pane 都没有),第一个补开的接任活跃,与 createPaneWorkspace 的语义一致。
    state: !hasActive && index === 0 ? "connecting" : "hidden",
  }));

  const instances = [...state.instances, ...appended];
  const activeInstanceId = state.activeInstanceId ?? appended[0]?.instanceId;
  return activeInstanceId === undefined ? { instances } : { instances, activeInstanceId };
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
      instances: [{ instanceId: action.instanceId, paneId: pane.id, epoch: 1, state: "connecting" }, ...instances],
      activeInstanceId: action.instanceId,
    };
  }
  if (action.type === "activate") {
    const target = state.instances.find((instance) => instance.instanceId === action.instanceId);
    if (target === undefined) return state;
    return {
      instances: state.instances.map((instance) => instance.instanceId === action.instanceId
        ? { ...target, state: target.state === "failed" ? "failed" as const : "ready" as const }
        : { ...instance, state: instance.state === "disposed" ? "disposed" as const : "hidden" as const }),
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

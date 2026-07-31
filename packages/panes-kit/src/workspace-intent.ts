/**
 * 宿主 UI → PanesHost 的工作区意图（与 agent custom tools `pane_open` / `pane_activate` 同语义）。
 *
 * launcherRail 等拿不到 PanesHost 实例时，经 window 事件投递；PanesHost 统一 apply。
 * 设置页等无 host 时事件无人听，静默无害。
 */
export const PI_PANES_WORKSPACE_INTENT_EVENT = "pi-panes-workspace-intent";
/** 请求宿主展开右侧栏（panelRight / panes）。 */
export const PI_PANES_PANEL_OPEN_EVENT = "pi-panes-panel-open";

export type PaneWorkspaceHostIntent =
  | { readonly type: "open"; readonly paneId: string }
  | {
      readonly type: "activate";
      readonly paneId?: string;
      readonly instanceId?: string;
    }
  /** 已有该 pane 实例则 activate（含 unpark），否则 open 新 tab——侧栏入口推荐。 */
  | { readonly type: "open-or-activate"; readonly paneId: string };

export function requestPaneWorkspaceIntent(
  intent: PaneWorkspaceHostIntent,
  target: Window = window,
): void {
  target.dispatchEvent(
    new CustomEvent(PI_PANES_WORKSPACE_INTENT_EVENT, { detail: intent }),
  );
}

/** 展开右侧 panes 栏（chat-app 监听后 setPanelRightOpen(true)）。 */
export function requestPanesPanelOpen(target: Window = window): void {
  target.dispatchEvent(new Event(PI_PANES_PANEL_OPEN_EVENT));
}

/**
 * 侧栏入口一键：开右栏 + open-or-activate 目标 pane（对标 pane_open / pane_activate 组合）。
 */
export function openOrActivatePaneFromHost(
  paneId: string,
  target: Window = window,
): void {
  requestPanesPanelOpen(target);
  requestPaneWorkspaceIntent({ type: "open-or-activate", paneId }, target);
}

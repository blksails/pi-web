// [迁移壳层] 源:aigc-agent components/workspace-panel.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { Activity } from "react";
import { X } from "lucide-react";
import type {
  WebExtSurfaceAccess,
  ConversationAccess,
} from "@blksails/pi-web-kit";
import type { GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  getWorkspaceModule,
  listWorkspaceModules,
  type WorkspaceModule,
  type WorkspaceModuleContext,
} from "./lib/module-registry.js";
import {
  collapseIfNarrow,
  listPanes,
  paneRects,
  zoneAt,
  type DropZone,
  type PaneNode,
  type Rect,
} from "./lib/layout-tree.js";
import {
  activateWorkspaceInstance,
  closeWorkspaceInstance,
  hydrateWorkspace,
  moveWorkspaceInstance,
  openWorkspaceModule,
  useWorkspaceState,
} from "./lib/workspace-store.js";

/**
 * WorkspacePanel — panelRight slot 的工作区容器（分屏 + Tab + `<Activity>` 保活）。
 *
 * **核心不变量：模块实例在 React 树里的位置恒定。** 它们是 `.aigc-ws-canvas` 下扁平、
 * 顺序恒定的一串 `<Activity>`，靠**百分比矩形**绝对定位到自己所属的窗；拖到别的窗、切分屏、
 * 响应式收敛都**只改 inline style**，DOM 节点从不移动 ⇒ iframe 不重载、画布图层/撤销栈不丢。
 * （上游三份设计稿给的解法是 portal 单例挂载点；`createPortal` 换 container 同样重挂子树，
 * 在 DOM 里移动 `<iframe>` 更是必然重载 —— 理由见 `CONTRACT-iteration-6.md`「已定方案」。）
 *
 * 非激活模块一律 `<Activity mode="hidden">`，**绝不条件渲染**（条件渲染 = 卸载 = 状态全丢）。
 * 不自开空闲控制流（PiChat 声明 panelRight 即开）；面板总宽归 PiChat 的 `panelWidth`。
 */
const STATE_KEY = "surface:canvas";
/** 每个窗顶部 Tab 条的高度（矩形是百分比，减去它才是内容区）。 */
const TAB_BAR_PX = 34;

/** 从 slot 的 surface 读画廊快照；无 connection 场景的画廊数据源。 */
function useSurfaceGallery(
  surface: WebExtSurfaceAccess | undefined,
): GalleryState | null {
  const subscribe = React.useCallback(
    (cb: () => void): (() => void) =>
      surface?.subscribe?.(STATE_KEY, cb) ?? (() => {}),
    [surface],
  );
  const getSnapshot = React.useCallback(
    (): GalleryState | null => surface?.getState<GalleryState>(STATE_KEY) ?? null,
    [surface],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 单个模块的宿主：把 visibility 生命周期绑到 effect 上。
 *
 * 本组件渲染在 `<Activity>` **内部**——mode 切到 `hidden` 时 React 清理子树 effect，
 * cleanup 即 `onVisibilityChange(false)`；切回 `visible` 时重建，即 `(true)`。用
 * `useLayoutEffect` 而非 `useEffect`：清理语义与「视觉上被隐藏」同步，避免被 Suspense /
 * ViewTransition 推迟（React 官方 `<Activity>` 文档的明确建议）。
 */
function ModuleHost({
  mod,
  base,
  closeSelf,
}: {
  readonly mod: WorkspaceModule;
  /** 共享上下文（不含 closeSelf）；引用必须稳定，否则 visibility 会抖。 */
  readonly base: Omit<WorkspaceModuleContext, "closeSelf">;
  readonly closeSelf: () => void;
}): React.JSX.Element {
  const ctx = React.useMemo<WorkspaceModuleContext>(
    () => ({ ...base, closeSelf }),
    [base, closeSelf],
  );
  React.useLayoutEffect(() => {
    mod.onVisibilityChange?.(true, ctx);
    return () => {
      mod.onVisibilityChange?.(false, ctx);
    };
  }, [mod, ctx]);
  return <>{mod.render(ctx)}</>;
}

/** 拖拽高亮遮罩的矩形：中心 = 整窗，四边 = 该侧半窗（来源 04 §5.4）。 */
function dropHighlight(pane: Rect, zone: DropZone): Rect {
  switch (zone) {
    case "left":
      return { ...pane, width: pane.width / 2 };
    case "right":
      return { ...pane, left: pane.left + pane.width / 2, width: pane.width / 2 };
    case "top":
      return { ...pane, height: pane.height / 2 };
    case "bottom":
      return { ...pane, top: pane.top + pane.height / 2, height: pane.height / 2 };
    default:
      return pane;
  }
}

function rectStyle(r: Rect): React.CSSProperties {
  return {
    left: `${r.left}%`,
    top: `${r.top}%`,
    width: `${r.width}%`,
    height: `${r.height}%`,
  };
}

export function WorkspacePanel({
  surface,
  conversation,
  sessionId,
  baseUrl,
}: {
  readonly surface?: WebExtSurfaceAccess;
  readonly conversation?: ConversationAccess;
  readonly sessionId?: string;
  readonly baseUrl?: string;
}): React.JSX.Element {
  const galleryState = useSurfaceGallery(surface);
  const state = useWorkspaceState();
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = React.useState(0);

  React.useEffect(() => {
    hydrateWorkspace();
  }, []);

  // 响应式收敛的判据（来源 04 §5.5）：右栏总宽。
  React.useEffect(() => {
    const el = canvasRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = React.useMemo(
    () =>
      collapseIfNarrow(
        state.layout,
        widthPx === 0 ? Number.POSITIVE_INFINITY : widthPx,
      ),
    [state.layout, widthPx],
  );
  const panes = React.useMemo(() => listPanes(layout), [layout]);
  const rects = React.useMemo(() => paneRects(layout), [layout]);
  const paneOfInstance = React.useMemo(() => {
    const m = new Map<string, PaneNode>();
    for (const p of panes) for (const t of p.tabs) m.set(t, p);
    return m;
  }, [panes]);

  const ctxBase = React.useMemo<Omit<WorkspaceModuleContext, "closeSelf">>(
    () => ({
      baseUrl: baseUrl ?? "/api",
      galleryState,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(surface !== undefined ? { surface } : {}),
      ...(conversation !== undefined ? { conversation } : {}),
    }),
    [baseUrl, galleryState, sessionId, surface, conversation],
  );

  // per-instance 的稳定 closeSelf：每次 render 新建闭包会让 ModuleHost 的 ctx 变引用，
  // 进而反复触发 visibility 钩子（隐藏/恢复抖动）。
  const closeFnsRef = React.useRef(new Map<string, () => void>());
  const closeFnFor = React.useCallback((id: string): (() => void) => {
    let fn = closeFnsRef.current.get(id);
    if (fn === undefined) {
      fn = (): void => closeWorkspaceInstance(id);
      closeFnsRef.current.set(id, fn);
    }
    return fn;
  }, []);

  // 左栏与其它宿主组件经自定义事件请求打开模块（不 prop-drill 穿过 vendor slot 边界）。
  React.useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ id?: string; title?: string }>).detail;
      if (typeof detail?.id !== "string") return;
      openWorkspaceModule(
        detail.id,
        detail.title !== undefined ? { title: detail.title } : {},
      );
    };
    window.addEventListener("aigc-open-workspace-module", onOpen);
    return () => window.removeEventListener("aigc-open-workspace-module", onOpen);
  }, []);

  // ── 拖拽停靠 ────────────────────────────────────────────────────────────────
  const [drag, setDrag] = React.useState<{
    readonly instanceId: string;
    readonly paneId: string;
    readonly zone: DropZone;
  } | null>(null);
  const rectsRef = React.useRef(rects);
  rectsRef.current = rects;

  const hitTest = React.useCallback(
    (cx: number, cy: number): { paneId: string; zone: DropZone } | null => {
      const el = canvasRef.current;
      if (el === null) return null;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      const px = ((cx - box.left) / box.width) * 100;
      const py = ((cy - box.top) / box.height) * 100;
      for (const [paneId, r] of rectsRef.current) {
        if (
          px >= r.left &&
          px <= r.left + r.width &&
          py >= r.top &&
          py <= r.top + r.height
        ) {
          return {
            paneId,
            zone: zoneAt((px - r.left) / r.width, (py - r.top) / r.height),
          };
        }
      }
      return null;
    },
    [],
  );

  const beginDrag = React.useCallback(
    (e: React.PointerEvent, instanceId: string): void => {
      if (e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      const move = (ev: PointerEvent): void => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) {
          return;
        }
        moved = true;
        const hit = hitTest(ev.clientX, ev.clientY);
        setDrag(hit === null ? null : { instanceId, ...hit });
      };
      const up = (ev: PointerEvent): void => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (moved) {
          const hit = hitTest(ev.clientX, ev.clientY);
          if (hit !== null) moveWorkspaceInstance(instanceId, hit.paneId, hit.zone);
        }
        setDrag(null);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [hitTest],
  );

  // ── 键盘导航（来源 04 §4.5：←→↑↓ 切换、Home/End 首末；roving tabindex） ──────
  const onTabKeyDown = React.useCallback(
    (e: React.KeyboardEvent, pane: PaneNode, idx: number): void => {
      const n = pane.tabs.length;
      if (n === 0) return;
      let next: number;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = (idx + 1) % n;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = (idx - 1 + n) % n;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = n - 1;
          break;
        case "Delete":
          e.preventDefault();
          closeWorkspaceInstance(pane.tabs[idx]!);
          return;
        default:
          return;
      }
      e.preventDefault();
      const id = pane.tabs[next]!;
      activateWorkspaceInstance(id);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-ws-tab="${id}"] button[role="tab"]`)
          ?.focus();
      });
    },
    [],
  );

  const titleOf = React.useCallback(
    (instanceId: string): string => {
      const inst = state.instances.find((i) => i.instanceId === instanceId);
      if (inst === undefined) return instanceId;
      return inst.title ?? getWorkspaceModule(inst.moduleId)?.title ?? inst.moduleId;
    },
    [state.instances],
  );

  const dragRect = drag === null ? undefined : rects.get(drag.paneId);

  return (
    <aside className="aigc-col aigc-rightcol" data-workspace-panel>
      <div className="aigc-ws-canvas" ref={canvasRef}>
        {state.instances.length === 0 ? (
          <div className="aigc-ws-empty">
            从左栏「＋ 添加模块」打开画布、素材、搜图等工作区模块。
            {listWorkspaceModules().length === 0 ? "（当前无已注册模块）" : null}
          </div>
        ) : null}

        {/* 窗（Tab 条）——绝对定位到自己的百分比矩形。 */}
        {panes.map((pane) => {
          const r = rects.get(pane.id);
          if (r === undefined) return null;
          return (
            <div
              key={pane.id}
              className="aigc-ws-pane"
              data-ws-pane-id={pane.id}
              style={rectStyle(r)}
            >
              <div className="aigc-ws-tabs" role="tablist" aria-label="工作区模块">
                {pane.tabs.map((instanceId, idx) => {
                  const inst = state.instances.find(
                    (i) => i.instanceId === instanceId,
                  );
                  const mod =
                    inst === undefined
                      ? undefined
                      : getWorkspaceModule(inst.moduleId);
                  const Icon = mod?.icon;
                  const isActive = pane.activeTab === instanceId;
                  return (
                    <div
                      key={instanceId}
                      className={`aigc-ws-tab${isActive ? " on" : ""}`}
                      data-ws-tab={instanceId}
                      data-active={isActive ? "true" : "false"}
                    >
                      <button
                        type="button"
                        role="tab"
                        id={`ws-tab-${instanceId}`}
                        aria-selected={isActive}
                        aria-controls={`ws-panel-${instanceId}`}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => activateWorkspaceInstance(instanceId)}
                        onKeyDown={(e) => onTabKeyDown(e, pane, idx)}
                        onPointerDown={(e) => beginDrag(e, instanceId)}
                      >
                        {Icon !== undefined ? <Icon size={13} /> : null}
                        {titleOf(instanceId)}
                      </button>
                      <button
                        type="button"
                        className="x"
                        title={`关闭 ${titleOf(instanceId)}`}
                        aria-label={`关闭 ${titleOf(instanceId)}`}
                        onClick={() => closeWorkspaceInstance(instanceId)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 模块实例：扁平 + 顺序恒定 + 绝对定位。换窗只改 style，DOM 不动。 */}
        {state.instances.map((inst) => {
          const mod = getWorkspaceModule(inst.moduleId);
          if (mod === undefined) return null;
          const pane = paneOfInstance.get(inst.instanceId);
          const r = pane === undefined ? undefined : rects.get(pane.id);
          const isVisible = pane?.activeTab === inst.instanceId;
          const style: React.CSSProperties =
            r === undefined
              ? { left: 0, top: 0, width: 0, height: 0 }
              : {
                  left: `${r.left}%`,
                  width: `${r.width}%`,
                  top: `calc(${r.top}% + ${TAB_BAR_PX}px)`,
                  height: `calc(${r.height}% - ${TAB_BAR_PX}px)`,
                };
          return (
            // key 用稳定 instanceId：换 key 或换父级结构 = 位置变化 = 重建 = 状态丢失。
            <Activity key={inst.instanceId} mode={isVisible ? "visible" : "hidden"}>
              <div
                className="aigc-ws-pane-body"
                data-ws-pane={inst.instanceId}
                role="tabpanel"
                id={`ws-panel-${inst.instanceId}`}
                aria-labelledby={`ws-tab-${inst.instanceId}`}
                style={style}
              >
                <ModuleHost
                  mod={mod}
                  base={ctxBase}
                  closeSelf={closeFnFor(inst.instanceId)}
                />
              </div>
            </Activity>
          );
        })}

        {/* 停靠高亮：pointer-events:none 的遮罩层（来源 04 §5.4 实现建议）。 */}
        {drag !== null && dragRect !== undefined ? (
          <div
            className="aigc-ws-drop"
            data-ws-drop-zone={drag.zone}
            style={rectStyle(dropHighlight(dragRect, drag.zone))}
          />
        ) : null}
      </div>
    </aside>
  );
}

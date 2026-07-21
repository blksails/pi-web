// [迁移壳层] 源:aigc-agent components/workspace-launcher.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { Plus, Search, X } from "lucide-react";
import { listWorkspaceModules } from "./lib/module-registry.js";
import {
  activateWorkspaceInstance,
  closeWorkspaceInstance,
  hydrateWorkspace,
  openWorkspaceModule,
  useWorkspaceState,
} from "./lib/workspace-store.js";
import { setSearchQuery } from "./lib/search-query-store.js";

/**
 * 左栏的工作区入口（已打开模块列表 + ＋添加模块）与 Cmd/Ctrl+K 搜索浮层。
 *
 * 两处语义分离（来源 04 §5.1 决策 3）：「新建会话」只管会话流；「添加模块」只管往右侧
 * 工作区注入功能页面。
 *
 * **落点为何不是 vendor 的 `launcherRail` 槽**（来源 04 §10.6 的建议）：本仓宿主用自写
 * `AgentSourceRail` 作左栏，**未渲染** vendor 的 `LauncherRail`；挂那个槽会凭空多出第二条
 * 导航栏。改落自家左栏的 `modulesSlot`，语义等价、同样零改 vendor。
 */

/** 请求宿主展开右栏（模块被打开时右栏可能是收起的）。 */
function revealWorkspace(): void {
  window.dispatchEvent(new Event("aigc-reveal-workspace"));
}

export function WorkspaceRailSection(): React.JSX.Element {
  const state = useWorkspaceState();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const mods = listWorkspaceModules();

  React.useEffect(() => {
    hydrateWorkspace();
  }, []);

  const openModuleIds = new Set(state.instances.map((i) => i.moduleId));

  return (
    <div className="aigc-rail-modules" data-rail-modules>
      {state.instances.map((inst) => {
        const mod = mods.find((m) => m.id === inst.moduleId);
        const Icon = mod?.icon;
        const label = inst.title ?? mod?.title ?? inst.moduleId;
        return (
          <div
            key={inst.instanceId}
            className="aigc-rail-mod"
            data-rail-module={inst.instanceId}
          >
            <button
              type="button"
              onClick={() => {
                activateWorkspaceInstance(inst.instanceId);
                revealWorkspace();
              }}
            >
              {Icon !== undefined ? <Icon size={14} /> : null}
              <span>{label}</span>
            </button>
            <button
              type="button"
              className="x"
              title={`关闭 ${label}`}
              aria-label={`关闭 ${label}`}
              onClick={() => closeWorkspaceInstance(inst.instanceId)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="aigc-tb-btn"
        data-add-module
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Plus size={14} /> 添加模块
      </button>

      {menuOpen ? (
        <div className="aigc-modmenu" role="menu" data-add-module-menu>
          {mods.length === 0 ? (
            <div className="empty">当前无已注册模块</div>
          ) : (
            mods.map((m) => {
              const Icon = m.icon;
              const already = openModuleIds.has(m.id) && m.allowMultiple !== true;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  data-add-module-item={m.id}
                  onClick={() => {
                    openWorkspaceModule(m.id);
                    revealWorkspace();
                    setMenuOpen(false);
                  }}
                >
                  {Icon !== undefined ? <Icon size={14} /> : null}
                  <span className="t">{m.title}</span>
                  {m.description !== undefined ? (
                    <span className="d">{m.description}</span>
                  ) : null}
                  {already ? <span className="on">已打开</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Search-to-Tab（来源 04 §5.6）：搜索**收敛为一个按钮 + 浮层**，不占常驻输入框空间；
 * 回车 → 右栏新建/聚焦「搜图」模块并带入查询词（已存在则刷新内容并切前台，不重开）。
 */
export function SearchCommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpenReq = (): void => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("aigc-open-search-palette", onOpenReq);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("aigc-open-search-palette", onOpenReq);
    };
  }, []);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submit = (): void => {
    const term = q.trim();
    if (term === "") return;
    setSearchQuery(term);
    openWorkspaceModule("search", { title: `搜索: ${term}` });
    revealWorkspace();
    setOpen(false);
  };

  return (
    <div
      className="aigc-palette-backdrop"
      data-search-palette
      onClick={() => setOpen(false)}
    >
      <div
        className="aigc-palette"
        role="dialog"
        aria-modal="true"
        aria-label="以词搜图"
        onClick={(e) => e.stopPropagation()}
      >
        <Search size={15} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="以词搜图，如「赛博朋克 蓝色霓虹 居中构图」"
          data-palette-input
        />
        <kbd>Esc</kbd>
      </div>
    </div>
  );
}

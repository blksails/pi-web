// [迁移壳层] 源:aigc-agent lib/workspace/module-registry.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * 工作区模块注册表（宿主侧，纯本仓）。
 *
 * 右栏从「画布一体机」改为「可注册模块的工作区容器」：canvas / 素材 / 搜图 / 内置浏览器
 * / 未来任意工作站，都按 `WorkspaceModule` 注册一条，左栏「添加模块」菜单与右栏 Tab 条
 * 自动长出，**外壳零改动**。设计见
 * `docs/superpowers/specs/2026-07-20-workspace-module-shell-design.md`。
 *
 * 注册表是**模块级单例**（Map 在模块作用域）——不可放进组件内，否则每次 render 重建会
 * 让所有模块实例连同其 DOM 一起重挂，等于状态全丢（来源 04 §7.2 D7 的教训）。
 */
import type { ComponentType, ReactNode } from "react";
import type {
  WebExtSurfaceAccess,
  ConversationAccess,
} from "@blksails/pi-web-kit";
import type { GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

/** 模块渲染时能拿到的宿主上下文——只给**已有**的东西，不新造通道。 */
export interface WorkspaceModuleContext {
  readonly sessionId?: string;
  readonly baseUrl: string;
  readonly surface?: WebExtSurfaceAccess;
  readonly conversation?: ConversationAccess;
  /** 画廊权威快照（由 slot 的 surface 派生），画布与素材共用。 */
  readonly galleryState: GalleryState | null;
  /** 关闭自己这个 Tab（模块内的「隐藏/关闭」按钮接到这里）。 */
  readonly closeSelf: () => void;
}

export interface WorkspaceModule {
  /** 唯一标识，如 `canvas` / `materials` / `search`。 */
  readonly id: string;
  /** Tab 条与菜单里显示的名字。 */
  readonly title: string;
  readonly icon?: ComponentType<{ size?: number }>;
  readonly description?: string;
  /** 渲染模块内容。宿主组件直接返回组件；未来 iframe 模块返回带沙箱的包装件。 */
  readonly render: (ctx: WorkspaceModuleContext) => ReactNode;
  /**
   * 隐藏/恢复通知。**iframe 模块必须实现**：React 官方把 `<iframe>` 列为「隐藏 ≠ 卸载、
   * 副作用残留」三大标签之一，隐藏后必须由宿主主动通知其停 rAF / 断连 / 停轮询。
   */
  readonly onVisibilityChange?: (
    visible: boolean,
    ctx: WorkspaceModuleContext,
  ) => void;
  /** 首次进入右栏即打开（默认 false，按需由用户从菜单添加）。 */
  readonly openByDefault?: boolean;
  /** 允许同时开多个实例（如「搜索结果」每次查询一个）；默认单例。 */
  readonly allowMultiple?: boolean;
}

const REGISTRY = new Map<string, WorkspaceModule>();

/** 注册一个模块；重复 id 抛错（静默覆盖会让两处代码悄悄争夺同一 Tab）。 */
export function registerWorkspaceModule(mod: WorkspaceModule): void {
  if (REGISTRY.has(mod.id)) {
    throw new Error(`workspace module already registered: ${mod.id}`);
  }
  REGISTRY.set(mod.id, mod);
}

/** 按注册顺序列出全部模块。 */
export function listWorkspaceModules(): readonly WorkspaceModule[] {
  return [...REGISTRY.values()];
}

export function getWorkspaceModule(id: string): WorkspaceModule | undefined {
  return REGISTRY.get(id);
}

/** 默认打开的模块 id（右栏首帧的 Tab 集合）。 */
export function defaultOpenModuleIds(): readonly string[] {
  return listWorkspaceModules()
    .filter((m) => m.openByDefault === true)
    .map((m) => m.id);
}

/** 仅供测试：清空注册表（生产代码不要调用）。 */
export function __resetWorkspaceModules(): void {
  REGISTRY.clear();
}

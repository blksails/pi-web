/**
 * Pane 自带 tools 的绑定单元(agent 侧)。
 *
 * 「pane 的工具打包进 kit,agent 注册即用」的形式本已受 pi 支持:工具以
 * ExtensionFactory 形态发布(先例 `canvasSurfaceExtension`/`aigcExtension`),agent 列进
 * `extensions:` 即可,无需逐 agent 适配。本模块补的是**绑定与防漂移**:把「pane 元信息 +
 * 其 extensions + 其 routes」声明为一个 `PaneAgentModule`,`composePaneAgentModules`
 * 一次合并——
 *  - pane capability 声明的 route 名必须被某个模块的 routes 覆盖,否则抛错(声明与
 *    注册不再靠人肉对齐);
 *  - 同名 route 若非同一引用即冲突抛错;
 *  - extension 按恒等去重:多 pane 共享同一域扩展只装一次。
 *
 * web 侧照旧从各 pane 的 web-safe 元信息文件展开完整定义(document/lifecycle 只在
 * web 侧注入),agent 侧不引 srcDoc 产物。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

export type PaneExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

export interface PaneAgentModule {
  /** pane 元信息(与 web 侧定义同源;此处用于身份与 route 覆盖校验)。 */
  readonly pane: {
    readonly id: string;
    readonly capabilities?: { readonly routes?: ReadonlyArray<{ readonly name: string }> };
  };
  /** 该 pane 自带的 agent 工具/surface 扩展。 */
  readonly extensions?: readonly PaneExtensionFactory[];
  /** 该 pane 自带的声明式 HTTP routes。 */
  readonly routes?: readonly AgentRouteDecl[];
}

export interface ComposedPaneAgentModules {
  readonly extensions: PaneExtensionFactory[];
  readonly routes: AgentRouteDecl[];
}

export function composePaneAgentModules(modules: readonly PaneAgentModule[]): ComposedPaneAgentModules {
  const paneIds = new Set<string>();
  const routesByName = new Map<string, AgentRouteDecl>();
  const extensions: PaneExtensionFactory[] = [];
  const seenExtensions = new Set<PaneExtensionFactory>();
  for (const module of modules) {
    if (paneIds.has(module.pane.id)) throw new Error(`duplicate pane module: ${module.pane.id}`);
    paneIds.add(module.pane.id);
    for (const extension of module.extensions ?? []) {
      if (seenExtensions.has(extension)) continue;
      seenExtensions.add(extension);
      extensions.push(extension);
    }
    for (const route of module.routes ?? []) {
      const existing = routesByName.get(route.name);
      if (existing !== undefined && existing !== route) {
        throw new Error(`conflicting agent route "${route.name}" across pane modules`);
      }
      routesByName.set(route.name, route);
    }
  }
  for (const module of modules) {
    for (const grant of module.pane.capabilities?.routes ?? []) {
      if (!routesByName.has(grant.name)) {
        throw new Error(`pane "${module.pane.id}" grants route "${grant.name}" but no pane module provides it`);
      }
    }
  }
  return { extensions, routes: [...routesByName.values()] };
}

/**
 * host-assembly — 宿主贡献类型(spec: host-contract-capability-composition,M3;设计 D1)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5.3。
 *
 * `composeCapabilities<TDeps, TRoute>` 的 `TRoute` 在 pi-web 装配里取 `HostContribution` —— 一个
 * **可判别联合**,同时容纳「路由贡献」与「非路由的 `host.commands` 贡献」。于是 16 个能力面
 * (15 路由 + 1 命令)得以在**同一次** compose、**同一份** decisions 里被强制表态。装配层
 * (`lib/app/pi-handler.ts`)compose 后按 `kind` 分拣:route→`createPiWebHandler.routes`、
 * command→`hostCommands`。这直接消除「`host.commands` 因不产路由而游离于表态之外」的根因。
 *
 * ⚠ **D0 铁律**:本模块及 `default-capabilities.ts` 经 `@blksails/pi-web-server/host-assembly`
 * 子路径出口,**绝不**经 server 主 barrel `src/index.ts` 导出——`default-capabilities` 的
 * factory 会 import 真实工厂(含 pi SDK 传递依赖),若进主 barrel 会拖垮 routes bundle 的
 * `node:fs`。此处仅用 `import type`,零值导入。
 */
import type { InjectedRoute } from "../http/handler.types.js";
import type { HostCommandHandler } from "../commands/host-command-registry.js";

/** 一个能力面的产出:一条注入路由,或一个宿主命令处理器。 */
export type HostContribution =
  | { readonly kind: "route"; readonly route: InjectedRoute }
  | { readonly kind: "command"; readonly command: HostCommandHandler };

/** 把路由集包装为路由贡献(路由能力面 factory 用)。 */
export function asRoutes(routes: readonly InjectedRoute[]): readonly HostContribution[] {
  return routes.map((route): HostContribution => ({ kind: "route", route }));
}

/** 把命令集包装为命令贡献(`host.commands` factory 用)。 */
export function asCommands(
  commands: readonly HostCommandHandler[],
): readonly HostContribution[] {
  return commands.map((command): HostContribution => ({ kind: "command", command }));
}

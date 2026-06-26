/**
 * customUi — 经 ctx.ui.custom 向 web 前端推送一个自定义组件(注册名 + 可序列化 props)。
 *
 * 背景:pi SDK 在 RPC 模式下 `ctx.ui.custom()` 是空操作。pi-web runner 用 prototype-patch
 * 覆盖 `ctx.ui.custom` 为发帧实现(见 spec ctx-ui-custom-bridge / server custom-ui-wiring),
 * 约定从 pi `custom(factory, options)` 的 `options.__piWebCustomUi` 读取可序列化 payload。
 *
 * 本助手隐藏这套约定:agent 作者只需 `customUi(ctx.ui, { component, props })`。内部以 pi 要求的
 * `(factory, options)` 形态调用被覆盖的 `custom`,payload 走 options 扩展字段。factory 是 placeholder
 * (web 侧不渲染 TUI 工厂,由前端按注册名渲染),故传一个无副作用空函数。
 *
 * 与 {@link emitUi} 同哲学:`ui` 用宽松类型 + 运行时守卫,避免与 pi ExtensionUIContext 的内层
 * 工厂签名产生变型摩擦;未启用桥接的环境(custom 仍为 pi 空操作)下安全无副作用(fire-and-forget)。
 *
 * 注意:`ctx.ui.custom` 在工具 `execute` / 对话回合内调用 —— 推送的 data part 会挂到当前活动的
 * assistant 消息上。
 */

/** ctx.ui.custom 推送的声明式渲染描述:前端注册名 + 可序列化 props。 */
export interface CustomUiPayload {
  /** 前端注册表中的组件名(registerCustomUi 注册;未注册则降级占位)。 */
  readonly component: string;
  /** 透传给前端组件的可序列化 props。 */
  readonly props?: unknown;
}

/**
 * 约定:payload 经 pi `custom(factory, options)` 的 options 扩展字段透传。
 * 必须与 server 侧 custom-ui-wiring 的 `CUSTOM_UI_OPTIONS_KEY` 字面量一致(跨包字符串契约)。
 */
const CUSTOM_UI_OPTIONS_KEY = "__piWebCustomUi";

/**
 * 经被覆盖的 `ctx.ui.custom` 推送一个自定义组件描述。fire-and-forget(不等待返回)。
 *
 * @param ui      `ctx.ui`(pi ExtensionUIContext);宽松类型,内部按存在性守卫。
 * @param payload 注册名 + 可序列化 props。
 */
export function customUi(ui: unknown, payload: CustomUiPayload): void {
  const custom = (ui as { custom?: unknown } | null | undefined)?.custom;
  if (typeof custom !== "function") return;
  (custom as (factory: unknown, options?: unknown) => unknown).call(ui, () => undefined, {
    [CUSTOM_UI_OPTIONS_KEY]: { component: payload.component, props: payload.props },
  });
}

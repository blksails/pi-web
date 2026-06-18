/**
 * emitUi — 在工具 `execute` 内经 onUpdate 发出一个 server-driven UI 部件(data-pi-ui)。
 *
 * 约定通道(见 @pi-web/protocol 的 PI_UI_TOOL_DETAILS_KEY / extractToolDetailsUiSpec):
 * 把 UiSpec 放进 onUpdate 的 `partialResult.details[PI_UI_TOOL_DETAILS_KEY]`,pi SDK 据此
 * 产生 `tool_execution_update` 事件,server 翻译层识别后产出 `data-pi-ui` 帧,前端零配置渲染。
 *
 * `onUpdate` 即工具 `execute(toolCallId, params, signal, onUpdate, ctx)` 的第 4 个参数
 * (pi SDK 的 AgentToolUpdateCallback);此处用宽松类型,避免与工具 details 泛型耦合,
 * 让 agent 作者可直接 `emitUi(onUpdate, spec)` 而无类型摩擦。
 *
 * 注意:onUpdate 仅在工具执行期间有效 —— 即「agent 想发 UI,就在某个工具里 emitUi」。
 */
import { PI_UI_TOOL_DETAILS_KEY, type UiSpec } from "@pi-web/protocol";

export function emitUi(onUpdate: unknown, spec: UiSpec): void {
  if (typeof onUpdate !== "function") return;
  (onUpdate as (partialResult: { content: never[]; details: unknown }) => void)({
    content: [],
    details: { [PI_UI_TOOL_DETAILS_KEY]: spec },
  });
}

/**
 * Markdown — 可覆盖的富文本渲染位(pi-chat-customization 任务 2.4)。
 *
 * 默认实现复用既有 `Response`(streamdown 安全渲染),外观不变(Req 1.1);
 * 可由 components.Markdown 覆盖(Req 5.1/5.2)。契约与 `ResponseProps` 同构。
 */
export { Response as Markdown } from "../ui/response.js";
export type { ResponseProps as MarkdownProps } from "../ui/response.js";

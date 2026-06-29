/**
 * 标题生成纯逻辑(全部 pi 类型为 **type-only** import,零运行时依赖 → 可独立单测)。
 *
 * 不在此发起模型调用;`buildTitleContext` 把会话消息转成一次性总结上下文(转换器以参数注入,
 * 便于单测替身),实际 `completeSimple` 由扩展壳发起。所有产出标题经 {@link sanitizeTitle}
 * 保证不含换行/控制字符且不超长。
 */
import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  Context,
  Message,
  TextContent,
} from "@earendil-works/pi-ai";

/** agent_end 携带的会话消息元素类型(AgentMessage 未单独导出,经事件类型派生)。 */
export type AgentMessage = AgentEndEvent["messages"][number];

/** 指导模型产出短标题的 system 提示。 */
export const TITLE_SYSTEM_PROMPT =
  "You generate a very short, descriptive title for a chat conversation. " +
  "Reply with ONLY the title text — no quotes, no punctuation at the end, " +
  "no prefix like 'Title:'. Keep it concise (a few words).";

/** 控制字符(C0 + DEL),统一在清洗时折叠为空格。 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/gu;

/** 判断内容块是否文本块。 */
function isTextContent(c: unknown): c is TextContent {
  return (
    typeof c === "object" &&
    c !== null &&
    (c as { type?: unknown }).type === "text" &&
    typeof (c as { text?: unknown }).text === "string"
  );
}

/** 从消息 content(string | 内容块数组)抽取纯文本并拼接。 */
function contentToText(content: string | readonly unknown[]): string {
  if (typeof content === "string") return content;
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join(" ");
}

/**
 * 去换行与控制字符、首尾去空白,并按**字符边界**(`Array.from`,多字节 emoji 不截半)
 * 截断到 `maxLen`。空白或空输入返回 `""`。
 */
export function sanitizeTitle(raw: string, maxLen: number): string {
  // 控制字符(含换行/制表)折叠为空格,再合并多余空白并去首尾。
  const collapsed = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  const chars = Array.from(collapsed);
  if (maxLen > 0 && chars.length > maxLen) {
    return chars.slice(0, maxLen).join("").trim();
  }
  return collapsed;
}

/**
 * 启发式标题:取**首条**用户消息文本,经 {@link sanitizeTitle} 清洗截断。
 * 无用户文本则返回 `""`(调用方据此跳过设置,不设空标题)。
 */
export function heuristicTitle(
  messages: readonly AgentMessage[],
  maxLen: number,
): string {
  for (const m of messages) {
    if (m.role === "user") {
      const text = contentToText(m.content).trim();
      if (text.length > 0) return sanitizeTitle(text, maxLen);
    }
  }
  return "";
}

/**
 * 构造一次性总结上下文。`toLlm` 为消息转换器(壳注入 pi-agent-core `convertToLlm`),
 * 使本函数保持纯逻辑、可用替身单测。
 */
export function buildTitleContext(
  messages: readonly AgentMessage[],
  toLlm: (m: AgentMessage[]) => Message[],
): Context {
  return {
    systemPrompt: TITLE_SYSTEM_PROMPT,
    messages: toLlm([...messages]),
  };
}

/**
 * 从模型应答抽取标题文本(拼接 text 内容块);无文本返回 `""`。
 * 注意:此处**不**截断 —— 截断由调用方统一经 {@link sanitizeTitle} 处理。
 */
export function extractTitleText(msg: AssistantMessage): string {
  return contentToText(msg.content).trim();
}

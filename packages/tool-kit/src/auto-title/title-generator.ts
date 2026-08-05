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
  "no prefix like 'Title:'. Keep it concise (a few words). " +
  "Ignore attachment markers such as [attachment id=…]; never use attachment ids as titles.";

/** 控制字符(C0 + DEL),统一在清洗时折叠为空格。 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/gu;

/** XML/HTML 风格成对标签(如 skill / 命令调用 `<skill name="…">…</skill>`),整体移除。 */
const MARKUP_TAGS = /<\/?[a-zA-Z][^>]*>/gu;

/** 残留的孤立尖括号(被截断或不配对的标签),一并移除,避免标记字符泄漏进标题。 */
const STRAY_ANGLES = /[<>]/gu;

/**
 * 首部斜杠命令前缀(如 `/image_generation 一只赛博朋克`):命令是调用动作、非标题内容。
 * 仅匹配「`/` + 命令名(ASCII 词字符/连字符)+ 空白」,故仅在命令**带参**时剥离前缀、保留参数
 * (`/image_generation 一只赛博朋克` → `一只赛博朋克`);裸命令(如 `/help`,其后无空白)不匹配、保持原样不被清空。
 */
const LEADING_SLASH_COMMAND = /^\/[\w-]+\s+/u;

/**
 * 附件引用标记(上传/工具产出注入的 `[attachment id=att_… type=… name=…]`)。
 * 按字段结构匹配:完整标记与被截断的残片(无闭合 `]`,如 `[attachment id=att_VVYx9`)
 * 一并移除,避免 id 泄漏进标题(截断前整体移除是关键:否则 maxLen 会把标记切成半截 id)。
 * 残片不会吞掉标记后的用户正文(只吃 id/type/name 字段形态)。
 */
const ATTACHMENT_REF =
  /\[attachment\s+id=att_[^\s\]]*(?:\s+type=[^\s\]]+)?(?:\s+name=[^\]]*)?\]?/gu;

/**
 * 从**完整**附件标记提取 `name=` 值,供「仅附件、无用户正文」时作友好回退
 * (用文件名而不是 att_ id)。残片无闭合 `]` 时不提取。
 */
const ATTACHMENT_NAME =
  /\[attachment\s+id=att_[^\s\]]*(?:\s+type=[^\s\]]+)?\s+name=([^\]]*)\]/gu;

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
 * 剥离附件引用标记;顺带收集完整标记里的 `name=` 供空正文回退。
 * 标记整体替换为空格(后续空白归一),绝不保留 `att_` id。
 */
function stripAttachmentRefs(raw: string): { text: string; names: string[] } {
  const names: string[] = [];
  for (const m of raw.matchAll(ATTACHMENT_NAME)) {
    const n = (m[1] ?? "").trim();
    if (n.length > 0) names.push(n);
  }
  return { text: raw.replace(ATTACHMENT_REF, " "), names };
}

/**
 * 去换行与控制字符、首尾去空白,并按**字符边界**(`Array.from`,多字节 emoji 不截半)
 * 截断到 `maxLen`。空白或空输入返回 `""`。
 *
 * 另剥离:附件引用标记、XML/HTML 标签、首部斜杠命令。仅附件无正文时回退到附件
 * `name=`(文件名),绝不产出 `[attachment id=att_…]` 形态。
 */
export function sanitizeTitle(raw: string, maxLen: number): string {
  // 先剥附件引用(截断前整体移除,防止 maxLen 切出半截 `att_` id)。
  const { text: withoutAtt, names } = stripAttachmentRefs(raw);
  // 再剥 XML/HTML 标记标签(skill / 命令调用如 `<skill name="…">`)及残留孤立尖括号,
  // 避免标记字符泄漏进标题。
  const stripped = withoutAtt
    .replace(MARKUP_TAGS, " ")
    .replace(STRAY_ANGLES, " ");
  // 控制字符(含换行/制表)折叠为空格,再合并多余空白并去首尾。
  let collapsed = stripped
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // 剥离首部斜杠命令前缀(`/image_generation 一只赛博朋克` → `一只赛博朋克`):在空白归一后进行,
    // 确保命令名与参数以单空格分隔、前缀能被稳定匹配;带参才剥离,裸命令保持原样。
    .replace(LEADING_SLASH_COMMAND, "")
    .trim();
  // 仅附件、无用户正文 → 用第一个完整标记的 name 作友好回退(仍走下方长度截断)。
  if (collapsed.length === 0 && names.length > 0) {
    collapsed = names[0]!
      .replace(CONTROL_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (collapsed.length === 0) return "";
  const chars = Array.from(collapsed);
  if (maxLen > 0 && chars.length > maxLen) {
    return chars.slice(0, maxLen).join("").trim();
  }
  return collapsed;
}

/**
 * 启发式标题:按会话顺序取**首条能产出非空标题**的用户消息文本,经 {@link sanitizeTitle}
 * 清洗截断。某条用户消息清洗后为空(例如只有附件标记)则跳过、继续下一条;
 * 全部为空则返回 `""`(调用方据此跳过设置,不设空标题)。
 */
export function heuristicTitle(
  messages: readonly AgentMessage[],
  maxLen: number,
): string {
  for (const m of messages) {
    if (m.role === "user") {
      const text = contentToText(m.content).trim();
      if (text.length === 0) continue;
      const title = sanitizeTitle(text, maxLen);
      if (title !== "") return title;
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

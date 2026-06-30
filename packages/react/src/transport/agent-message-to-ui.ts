/**
 * agent-message-to-ui — 把 pi `AgentMessage[]`(get_messages / 持久化历史)转换为
 * AI SDK v5 `UIMessage[]`,用作 `useChat` 的初始消息以渲染恢复的会话历史。
 *
 * 映射(对齐 `PartRenderer` 消费的 part 类型):
 *  - user:`content` 为 string → 单个 text part;数组 → text / file(image)parts。
 *    text 经 `stripAttachmentRefs` 剥离 server 端 `injectAttachmentRefs` 注入的
 *    `[attachment id=… type=… name=…]` 占位符(对偶单向注入),避免历史回放把占位符当乱码显示。
 *    image part 的 url 按引用解析:带 `displayUrl`/公开 `attachmentId` → 分发端点 URL;
 *    遗留无 id 的内联 base64 → 重建 `data:` URL(防回归,见 `imageUrl`)。
 *  - assistant:`text` → text part;`thinking` → reasoning part;`toolCall` → dynamic-tool
 *    part(state `input-available`,携带 input)。`stopReason === "error"` → 追加一个
 *    `data-pi-error` part 承载 `errorMessage`,使历史回放也能内联展示该次失败(实时流式
 *    经 SSE `error` 帧走全局 ChatError,但 `get_messages` 历史路径此前丢弃错误故空白回放)。
 *  - toolResult:按 `toolCallId` 并入此前 assistant 的对应 tool part(置 `output-available`
 *    / `output-error`);找不到对应 tool part 时降级为独立的 dynamic-tool part。
 *  - 其它(自定义 passthrough role):跳过。
 *
 * `AgentMessage` 含 `{ role: string }` passthrough 成员,无法干净判别收窄,故内部以
 * `Record` 访问字段。纯函数:消息 id 由下标稳定生成(`msg-<i>`),无模块级可变状态。
 */
import type { UIMessage } from "ai";
import type { AgentMessage } from "@blksails/pi-web-protocol";
import { joinUrl } from "../client/request.js";

type UIPart = UIMessage["parts"][number];

/**
 * assistant `stopReason === "error"` 但 `errorMessage` 缺失时的兜底文案。
 * 与 server 端 `translate-event.ts` 的 `FALLBACK_ERROR_TEXT` 保持一致,使历史回放
 * 与实时流式的错误占位文案统一。
 */
const FALLBACK_ERROR_TEXT = "对话失败,但运行时未提供具体错误信息。";

/** 翻译选项。`baseUrl`(如 `/api`)用于把根相对的分发 URL 前缀为可达 URL。 */
export interface AgentMessagesToUiOptions {
  /**
   * http-api 根地址(如 `/api`)。历史项的分发 URL 由 `attachmentId` 构造为**根相对**
   * `/attachments/:id/raw`,但 Next 只在 `/api/attachments/:id/raw` 服务,根相对会 404;
   * 故展示侧用 `baseUrl` 前缀(与 `useAttachments.resolveDisplayUrl` 同策略)。
   * 仅根相对(以 `/` 开头且非 http(s))才前缀;绝对 http(s) 与 `data:` 原样。
   * baseUrl 仅作展示前缀,不进 HMAC 签名输入。
   */
  readonly baseUrl?: string;
}

/**
 * 把根相对的展示 URL 用 baseUrl 解析为前端可达 URL(与 useAttachments.resolveDisplayUrl
 * 同策略):绝对 http(s) 原样;`data:`/相对非 `/` 原样;仅根相对(`/` 开头)经 joinUrl 前缀。
 */
function resolveDisplayUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return url;
  if (baseUrl === "") return url;
  // 已含 baseUrl 前缀(displayUrl 可能已是完整 `/api/attachments/...`)→ 不重复 prepend,
  // 避免 `/api/api/...` 双前缀 404。仅纯根相对(如 attachmentId 构造的 `/attachments/...`)才前缀。
  if (url === baseUrl || url.startsWith(`${baseUrl}/`)) return url;
  return joinUrl(baseUrl, url);
}

/** 可变的 dynamic-tool part 句柄,供 toolResult 回填 output/state。 */
interface MutableToolPart {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: "input-available" | "output-available" | "output-error";
  input: unknown;
  output?: unknown;
  errorText?: string;
}

interface ContentItem {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  mimeType?: unknown;
  data?: unknown;
  /** 已落库附件的公开 id(`att_<nanoid>`),历史回显据此走分发 URL。 */
  attachmentId?: unknown;
  /** server 即时签发的分发展示 URL(`/attachments/:id/raw?exp&sig`)。 */
  displayUrl?: unknown;
}

/**
 * 把历史 image content 解析为可渲染 URL(Req 6.1/6.2/6.3):
 *  - 带分发 `displayUrl`(http(s) 原样 / 根相对经 baseUrl 前缀)→ 作为分发 URL;
 *  - 带公开 `attachmentId`(`att_…`)→ 构造分发端点路径 `/attachments/:id/raw` 后经
 *    baseUrl 前缀为 `/api/attachments/:id/raw`(否则 Next 根相对会 404);
 *  - 否则(遗留无 id 的内联 base64)→ 重建 `data:` 内联 URL(防回归,baseUrl 不前缀)。
 */
function imageUrl(raw: ContentItem, baseUrl: string): string {
  const displayUrl = raw.displayUrl;
  if (typeof displayUrl === "string" && displayUrl !== "") {
    return resolveDisplayUrl(baseUrl, displayUrl);
  }
  const attachmentId = raw.attachmentId;
  if (typeof attachmentId === "string" && attachmentId !== "") {
    return resolveDisplayUrl(baseUrl, `/attachments/${attachmentId}/raw`);
  }
  // 遗留:无公开 id,重建内联 data: URL(非根相对,baseUrl 不前缀)。
  return `data:${String(raw.mimeType ?? "")};base64,${String(raw.data ?? "")}`;
}

/** 把内容数组中的文本拼接为一个字符串(用于 tool 错误文本)。 */
function joinText(content: readonly ContentItem[]): string {
  return content
    .filter((c) => c.type === "text")
    .map((c) => String(c.text ?? ""))
    .join("");
}

/**
 * 剥离注入到用户消息文本里的附件引用占位符块(与 server 端 `injectAttachmentRefs`
 * 对偶):每个 `[attachment id=att_… type=<mime> name=<name>]` 标记连同其行尾换行一并移除,
 * 再去掉块后残留的前导空行,只保留用户真正输入的文本。
 *
 * 背景:`injectAttachmentRefs`(`packages/server/src/attachment-bridge/reference-injection.ts`)
 * 把这些占位符注入用户消息文本以**送给模型**抄 id 调 tool;它是单向的。历史回放经
 * `get_messages` 取出的 user `content` 已含占位符,若直接当文本渲染会把 `[attachment …]`
 * 当作可见乱码显示给用户(刷新后才暴露,与发送当下只见纯文本不一致)。此处做反向剥离,
 * 使历史里的用户气泡与发送当下一致——只显示用户输入文本。
 *
 * 仅匹配 `[attachment id=… type=… name=…]` 这一稳定形态,不误伤用户输入的普通方括号文本。
 */
const ATTACHMENT_REF_RE = /\[attachment id=\S+ type=\S+ name=[^\]]*\]\n?/g;
function stripAttachmentRefs(text: string): string {
  if (!text.includes("[attachment id=")) return text;
  return text.replace(ATTACHMENT_REF_RE, "").replace(/^\n+/, "");
}

/**
 * 把 skill 命令展开块**折叠回原始斜杠命令**用于历史显示(plugin-system-unification R14)。
 *
 * 背景(与 stripAttachmentRefs 同性质的"为显示反转服务端注入"):`/skill:<name> [args]` 不是
 * 扩展命令,pi SDK 的 `AgentSession._expandSkillCommand` 把它**展开成 `<skill name="…">…</skill>`
 * 块当 prompt** 送给模型(展开内容进 LLM 上下文是 skill 的本意)。但 `get_messages` 历史回放取出的
 * user 文本即该展开块,直接渲染会显示成一大段 SKILL.md 正文——与发送当下用户只见 `/skill:<name>`
 * 短命令(useChat 乐观气泡)**不一致**(刷新后才暴露)。此处反向折叠,使历史用户气泡与发送当下一致。
 *
 * SDK 展开形态(`agent-session.js`):
 *   `<skill name="${name}" location="${path}">\nReferences are relative to ${base}.\n\n${body}\n</skill>`
 *   + 有 args 时追加 `\n\n${args}`。
 * 仅匹配 `^<skill name="…" location="…">…</skill>` 这一稳定形态(非贪婪到首个 `</skill>`),不误伤
 * 用户输入的普通文本;不匹配(如 body 含 `</skill>` 致尾部不是 `\n\n<args>$`)则原样返回(安全降级)。
 * 仅改显示,不影响 server message log(模型上下文仍是展开内容)。
 */
const SKILL_EXPANSION_RE =
  /^<skill name="([^"]*)" location="[^"]*">[\s\S]*?<\/skill>(?:\n\n([\s\S]*))?$/;
function collapseSkillExpansion(text: string): string {
  if (!text.startsWith('<skill name="')) return text;
  const m = SKILL_EXPANSION_RE.exec(text);
  if (m === null) return text;
  const name = m[1] ?? "";
  const args = (m[2] ?? "").trim();
  return args.length > 0 ? `/skill:${name} ${args}` : `/skill:${name}`;
}

/** user 消息内容 → UI parts(text / file);剥离附件引用占位符(见 stripAttachmentRefs)。 */
function userParts(content: unknown, baseUrl: string): UIPart[] {
  if (typeof content === "string") {
    // 先折叠 skill 展开块(与发送当下短命令一致),再剥离附件占位符。
    const text = stripAttachmentRefs(collapseSkillExpansion(content));
    // 纯附件消息(占位符剥离后无真实文本)→ 不产生空 text part。
    if (content.includes("[attachment id=") && text === "") return [];
    return [{ type: "text", text, state: "done" } as UIPart];
  }
  if (!Array.isArray(content)) return [];
  const parts: UIPart[] = [];
  for (const raw of content as ContentItem[]) {
    if (raw.type === "text") {
      const original = String(raw.text ?? "");
      const text = stripAttachmentRefs(collapseSkillExpansion(original));
      // 纯附件 text item(占位符剥离后无真实文本)→ 跳过,避免空 text part;
      // 不含占位符的(含原本就空的)保持既有行为,原样产出。
      if (original.includes("[attachment id=") && text === "") continue;
      parts.push({ type: "text", text, state: "done" } as UIPart);
    } else if (raw.type === "image") {
      parts.push({
        type: "file",
        mediaType: String(raw.mimeType ?? "application/octet-stream"),
        url: imageUrl(raw, baseUrl),
      } as UIPart);
    }
  }
  return parts;
}

/** 转换历史 AgentMessage 序列为 UIMessage 序列。 */
export function agentMessagesToUiMessages(
  messages: ReadonlyArray<AgentMessage>,
  options: AgentMessagesToUiOptions = {},
): UIMessage[] {
  const baseUrl = options.baseUrl ?? "";
  const out: UIMessage[] = [];
  // toolCallId → 句柄(同一对象同时放入 parts 数组,回填即生效)。
  const toolParts = new Map<string, MutableToolPart>();

  messages.forEach((msg, index) => {
    const m = msg as unknown as Record<string, unknown>;
    const role = m["role"];
    const id = `msg-${index}`;

    if (role === "user") {
      out.push({ id, role: "user", parts: userParts(m["content"], baseUrl) });
      return;
    }

    if (role === "assistant") {
      const content = Array.isArray(m["content"])
        ? (m["content"] as ContentItem[])
        : [];
      const parts: UIPart[] = [];
      for (const c of content) {
        if (c.type === "text") {
          parts.push({ type: "text", text: String(c.text ?? ""), state: "done" } as UIPart);
        } else if (c.type === "thinking") {
          parts.push({ type: "reasoning", text: String(c.thinking ?? ""), state: "done" } as UIPart);
        } else if (c.type === "toolCall") {
          const tp: MutableToolPart = {
            type: "dynamic-tool",
            toolName: String(c.name ?? "tool"),
            toolCallId: String(c.id ?? ""),
            state: "input-available",
            input: c.arguments ?? {},
          };
          toolParts.set(tp.toolCallId, tp);
          parts.push(tp as unknown as UIPart);
        }
      }
      // stopReason === "error":content 常为空,追加错误部件承载 errorMessage,
      // 否则历史回放只剩空气泡(实时流式靠 SSE error 帧,历史路径此前丢弃)。
      if (m["stopReason"] === "error") {
        const raw = m["errorMessage"];
        const errorText =
          typeof raw === "string" && raw !== "" ? raw : FALLBACK_ERROR_TEXT;
        parts.push({
          type: "data-pi-error",
          data: { errorText },
        } as unknown as UIPart);
      }
      out.push({ id, role: "assistant", parts });
      return;
    }

    if (role === "toolResult") {
      const toolCallId = String(m["toolCallId"] ?? "");
      const content = Array.isArray(m["content"])
        ? (m["content"] as ContentItem[])
        : [];
      const isError = m["isError"] === true;
      // 历史 toolResult 同样携带 details(pi 持久化保留;含 assets/displayUrl)。透传以与即时
      // streaming 的 output(translate-event 透传 event.result = { content, details })对齐,
      // 消除即时/历史在工具卡片上的展示差异。无 details 时退回纯 content(行为不变)。
      const details = m["details"];
      const existing = toolParts.get(toolCallId);
      if (existing !== undefined) {
        if (isError) {
          existing.state = "output-error";
          existing.errorText = joinText(content);
        } else {
          existing.state = "output-available";
          existing.output =
            details !== undefined ? { content, details } : content;
        }
        return;
      }
      // 孤立 toolResult:降级为独立 dynamic-tool part。
      const tp: MutableToolPart = {
        type: "dynamic-tool",
        toolName: String(m["toolName"] ?? "tool"),
        toolCallId,
        state: isError ? "output-error" : "output-available",
        input: {},
        ...(isError
          ? { errorText: joinText(content) }
          : {
              output: details !== undefined ? { content, details } : content,
            }),
      };
      out.push({ id, role: "assistant", parts: [tp as unknown as UIPart] });
    }
    // 其它 role:跳过。
  });

  return out;
}

/**
 * agent-message-to-ui — 把 pi `AgentMessage[]`(get_messages / 持久化历史)转换为
 * AI SDK v5 `UIMessage[]`,用作 `useChat` 的初始消息以渲染恢复的会话历史。
 *
 * 映射(对齐 `PartRenderer` 消费的 part 类型):
 *  - user:`content` 为 string → 单个 text part;数组 → text / file(image)parts。
 *    image part 的 url 按引用解析:带 `displayUrl`/公开 `attachmentId` → 分发端点 URL;
 *    遗留无 id 的内联 base64 → 重建 `data:` URL(防回归,见 `imageUrl`)。
 *  - assistant:`text` → text part;`thinking` → reasoning part;`toolCall` → dynamic-tool
 *    part(state `input-available`,携带 input)。
 *  - toolResult:按 `toolCallId` 并入此前 assistant 的对应 tool part(置 `output-available`
 *    / `output-error`);找不到对应 tool part 时降级为独立的 dynamic-tool part。
 *  - 其它(自定义 passthrough role):跳过。
 *
 * `AgentMessage` 含 `{ role: string }` passthrough 成员,无法干净判别收窄,故内部以
 * `Record` 访问字段。纯函数:消息 id 由下标稳定生成(`msg-<i>`),无模块级可变状态。
 */
import type { UIMessage } from "ai";
import type { AgentMessage } from "@pi-web/protocol";

type UIPart = UIMessage["parts"][number];

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
 *  - 带分发 `displayUrl`(http(s))→ 原样作为分发 URL;
 *  - 带公开 `attachmentId`(`att_…`)→ 构造分发端点路径 `/attachments/:id/raw`;
 *  - 否则(遗留无 id 的内联 base64)→ 重建 `data:` 内联 URL(防回归)。
 */
function imageUrl(raw: ContentItem): string {
  const displayUrl = raw.displayUrl;
  if (typeof displayUrl === "string" && displayUrl !== "") {
    return displayUrl;
  }
  const attachmentId = raw.attachmentId;
  if (typeof attachmentId === "string" && attachmentId !== "") {
    return `/attachments/${attachmentId}/raw`;
  }
  // 遗留:无公开 id,重建内联 data: URL。
  return `data:${String(raw.mimeType ?? "")};base64,${String(raw.data ?? "")}`;
}

/** 把内容数组中的文本拼接为一个字符串(用于 tool 错误文本)。 */
function joinText(content: readonly ContentItem[]): string {
  return content
    .filter((c) => c.type === "text")
    .map((c) => String(c.text ?? ""))
    .join("");
}

/** user 消息内容 → UI parts(text / file)。 */
function userParts(content: unknown): UIPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content, state: "done" } as UIPart];
  }
  if (!Array.isArray(content)) return [];
  const parts: UIPart[] = [];
  for (const raw of content as ContentItem[]) {
    if (raw.type === "text") {
      parts.push({ type: "text", text: String(raw.text ?? ""), state: "done" } as UIPart);
    } else if (raw.type === "image") {
      parts.push({
        type: "file",
        mediaType: String(raw.mimeType ?? "application/octet-stream"),
        url: imageUrl(raw),
      } as UIPart);
    }
  }
  return parts;
}

/** 转换历史 AgentMessage 序列为 UIMessage 序列。 */
export function agentMessagesToUiMessages(
  messages: ReadonlyArray<AgentMessage>,
): UIMessage[] {
  const out: UIMessage[] = [];
  // toolCallId → 句柄(同一对象同时放入 parts 数组,回填即生效)。
  const toolParts = new Map<string, MutableToolPart>();

  messages.forEach((msg, index) => {
    const m = msg as unknown as Record<string, unknown>;
    const role = m["role"];
    const id = `msg-${index}`;

    if (role === "user") {
      out.push({ id, role: "user", parts: userParts(m["content"]) });
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
      out.push({ id, role: "assistant", parts });
      return;
    }

    if (role === "toolResult") {
      const toolCallId = String(m["toolCallId"] ?? "");
      const content = Array.isArray(m["content"])
        ? (m["content"] as ContentItem[])
        : [];
      const isError = m["isError"] === true;
      const existing = toolParts.get(toolCallId);
      if (existing !== undefined) {
        if (isError) {
          existing.state = "output-error";
          existing.errorText = joinText(content);
        } else {
          existing.state = "output-available";
          existing.output = content;
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
        ...(isError ? { errorText: joinText(content) } : { output: content }),
      };
      out.push({ id, role: "assistant", parts: [tp as unknown as UIPart] });
    }
    // 其它 role:跳过。
  });

  return out;
}

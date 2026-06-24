/**
 * attachment-tool-bridge · `beforeToolCall` 属主校验闸门 `makeBeforeToolCall`
 * (task 3.1;Req 5.1, 5.2, 5.3, 5.4)。
 *
 * 在 tool `execute` **之前**集中守住一条边界:工具调用参数若携带附件引用
 * (`attachmentId`),必须由**当前会话**拥有该附件才放行;越权 / 不存在 / 无法校验属主
 * 一律 `block`,使 tool 不进入 `execute`,模型收到 error tool result(design §ownership-guard)。
 *
 * 设计约束(design.md §ownership-guard / §Error Categories):
 * - 从 `event.input`(已校验的工具参数)提取 `attachmentId`(string);
 *   无 `attachmentId`(或类型不符)→ 放行(返回 `undefined`),不阻断与附件无关的 tool(5.4)。
 * - 有 `attachmentId` → 经子进程 store 门面 `head(id)` 查属主;
 *   `head` 返回 `undefined`(不存在)或 `sessionId !== 当前会话`(越权)→ `{ block:true, reason }`(5.2/5.3)。
 * - store 不可用(env 缺失降级,见 {@link createChildAttachmentStore})且参数含 `attachmentId`:
 *   无法校验属主 → 不可放行,`block`(fail-closed:宁可阻断也不越权解析)。
 *
 * 返回结构遵循 pi 原生 `tool_call` 闸门的阻断契约 `{ block?: boolean; reason?: string }`
 * ——返回 `{ block:true }` 阻止该工具执行,`reason` 作为 error tool result 文本;
 * 放行时返回 `undefined`(不改写、不阻断)。
 *
 * 注意(类型来源):design 以 `NonNullable<AgentLoopConfig["beforeToolCall"]>` 描述签名,
 * 该类型属 `@earendil-works/pi-agent-core`(本仓库刻意不直接依赖的 pi 内层包,见
 * `@blksails/agent-kit` sdk-types 约定)。本切片在仓库**受认可**的 pi 公开面
 * `@earendil-works/pi-coding-agent` 上取**同形** `tool_call` 闸门契约
 * (`ToolCallEvent` / `ToolCallEventResult { block?, reason? }`,语义与 `BeforeToolCallResult` 一致)。
 */
import type { ChildAttachmentStore } from "./child-store.js";

/**
 * `tool_call` 闸门入参的最小读取面(对齐 pi `ToolCallEvent`):
 * 携带工具名、调用 id 与已校验参数对象。本闸门仅消费 `input` 取 `attachmentId`。
 */
export interface ToolCallGuardEvent {
  readonly toolName: string;
  readonly toolCallId: string;
  /** 已校验的工具参数对象(pi `CustomToolCallEvent.input: Record<string, unknown>`)。 */
  readonly input: Record<string, unknown>;
}

/**
 * `tool_call` 闸门返回(对齐 pi `ToolCallEventResult` / `BeforeToolCallResult`):
 * 返回 `{ block:true }` 阻止执行;`reason` 作为 error 文本。放行返回 `undefined`。
 */
export interface ToolCallGuardResult {
  block?: boolean;
  reason?: string;
}

/**
 * 附件公开 id 形态(`att_<nanoid>`)。属主校验**不依赖特定参数名**(如 `attachmentId`):
 * 不同工具用不同字段承载附件引用(例如 `image_edit` 用 `image_url` / `mask_url` /
 * `reference_image_urls`),若只认 `attachmentId` 字段会让这些工具的输入附件**绕过**属主
 * 校验(越权漏网)。故按**值形态**递归扫描所有参数,逐个校验属主。
 */
const ATTACHMENT_ID_RE = /^att_[A-Za-z0-9_-]+$/;

/**
 * 递归收集工具参数中所有形如 `att_<id>` 的附件引用(字符串值 / 数组 / 嵌套对象)。
 * 仅匹配**整串**为 att_ 形态者:`data:`/`https` URL、含 `att_` 子串的 base64 不会误命中。
 */
function collectAttachmentIds(value: unknown, acc: Set<string>): void {
  if (typeof value === "string") {
    if (ATTACHMENT_ID_RE.test(value)) acc.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectAttachmentIds(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectAttachmentIds(v, acc);
  }
}

/**
 * 构造 `tool_call` 前置属主校验闸门。
 *
 * @param store     子进程侧 store 门面客户端;`undefined` 表示附件能力不可用
 *                  (env 缺失降级)——此时任何携带 `attachmentId` 的调用都无法校验属主,fail-closed `block`。
 * @param sessionId 当前会话 id(属主校验依据,Req 5.x)。
 * @returns 一个异步闸门函数:放行返回 `undefined`,阻断返回 `{ block:true, reason }`。
 */
export function makeBeforeToolCall(
  store: ChildAttachmentStore | undefined,
  sessionId: string,
): (event: ToolCallGuardEvent) => Promise<ToolCallGuardResult | undefined> {
  return async (event) => {
    const ids = new Set<string>();
    collectAttachmentIds(event.input, ids);

    // 无附件引用 → 放行,不因属主校验阻断与附件无关的 tool(Req 5.4)。
    if (ids.size === 0) return undefined;

    // 逐个校验:任一越权 / 不存在 / 无法校验 → 阻断整个调用(fail-closed)。
    for (const attachmentId of ids) {
      // 含附件引用但 store 不可用 → 无法校验属主,fail-closed 阻断(不越权解析)。
      if (store === undefined) {
        return {
          block: true,
          reason: `Attachment storage unavailable; cannot verify ownership of ${attachmentId}.`,
        };
      }

      // 查属主:head 返回描述符(含属主 sessionId)或 undefined(不存在)。
      const head = await store.head(attachmentId);

      // 不存在 → 阻断,不把不存在引用当作可解析(Req 5.3)。
      if (head === undefined) {
        return {
          block: true,
          reason: `Attachment ${attachmentId} does not exist.`,
        };
      }

      // 越权:被引用附件属于他会话 → 阻断,使 tool 不进 execute(Req 5.2)。
      if (head.sessionId !== sessionId) {
        return {
          block: true,
          reason: `Attachment ${attachmentId} is not owned by the current session.`,
        };
      }
    }

    // 全部本会话拥有 → 放行(Req 5.1)。
    return undefined;
  };
}

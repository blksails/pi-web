/**
 * raw-line-router — 主进程侧「按 `type` 解复用子进程原始行」的注册表。
 *
 * ## 为什么
 *
 * `PiSession.handleRawLine` 原本是一条 185 行的 if-链,顺序判别九种 `type`。每加一个
 * 帧类型就往链尾再叠一段,而每段都在重复同一套骨架:
 *
 *     if (type === "X") { const p = XSchema.safeParse(parsed);
 *                         if (!p.success) return;   // 丢弃,或 warn 后丢弃
 *                         …真正的两三行… ; return; }
 *
 * ★ **这个问题在本仓已经解过一次**:同一条 IPC 通道的**子进程侧**,
 *   `@blksails/pi-web-runner` 的 `frame-channel/frame-router.ts` 就是按 `type` 查表分发
 *   的注册表(register(type, parser, handler) + 未注册即放行 + handler 抛错不外泄)。
 *   父进程侧此前没有对称物。本模块补齐,使两侧同构 —— 不是发明抽象,是把已有的对过来。
 *
 * ## 与子进程侧 FrameRouter 的差异(刻意)
 *
 *  - **不管流**:父进程的行来自 `channel.onLine`,已由 `PiRpcProcess` 拆好;本模块只做
 *    「解析 + 查表 + 派发」,不碰 stdin、不做 JSONL 缓冲。
 *  - **不回包**:handler 没有 `ctx.send`。父进程的上行走 SSE emitter 或 `channel.send`,
 *    由 handler 闭包各自持有,不经本路由 —— 给了 send 反而会让路由变成第二个上行出口。
 *  - **有 active 门**:少数帧只在会话 active 时处理(见 {@link RawLineEntry.requireActive})。
 */

/** 结构化 `safeParse` 视图(兼容 zod schema,不直接耦合 zod 类型)。 */
export interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error?: unknown };
}

/** 一种原始行类型的处置。 */
export interface RawLineEntry<T = unknown> {
  /** 结构校验器(通常是对应的 zod schema)。 */
  readonly schema: SafeParser<T>;
  /**
   * 校验通过后的处置。
   *
   * ★ 不返回值、不抛错为约定:原始行是**单向**下行,没有回执通道;handler 里抛错只会
   *   冒泡到 `onLine` 订阅者,污染无关的行处理。有失败要表达就自己记日志。
   */
  readonly handle: (data: T) => void;
  /**
   * 校验失败时的处置。缺省 = 静默丢弃。
   *
   * ★ 静默与告警的区别是**刻意**的,不是遗漏:结果帧(`*_result`)畸形时静默丢弃 ——
   *   它必然对应一个在途请求,超时兜底会给出更准确的错误;而装配期声明帧
   *   (`agent_routes` / `agent_attachment_*`)畸形必须 warn —— 它的后果是「该能力
   *   整个不可用」且没有别的地方会报。
   */
  readonly onInvalid?: (error: unknown) => void;
  /**
   * `true` = 仅在会话 active 时处理。缺省 `false`。
   *
   * ★ 绝大多数帧**刻意不设**此门:结果帧要在超时/收尾窗口里仍能配对在途请求,装配期
   *   声明帧要早于就绪门就被缓存。原实现里那句 `if (this._status !== "active") return;`
   *   位于九种帧之后、`ui_rpc_response` 之前 —— 那个位置就是本字段的语义来源,改动
   *   前请先确认新帧属于门前还是门后。
   */
  readonly requireActive?: boolean;
}

/** 建表用的条目集合:`type` → 处置。 */
export type RawLineTable = ReadonlyMap<string, RawLineEntry<never>>;

/**
 * 按 `type` 派发一行。
 *
 * @param line     子进程原始行(未解析)。
 * @param table    类型 → 处置。
 * @param isActive 会话是否 active(供 `requireActive` 判定)。
 * @returns 是否被某个条目消费(诊断/测试用;未注册类型与非 JSON 行返回 `false`)。
 */
export function dispatchRawLine(
  line: string,
  table: RawLineTable,
  isActive: boolean,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false; // 非 JSON 行忽略
  }
  if (parsed === null || typeof parsed !== "object") return false;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string") return false;

  const entry = table.get(type) as RawLineEntry<unknown> | undefined;
  if (entry === undefined) return false; // 未注册类型:放行(其它订阅者可能在处理)
  if (entry.requireActive === true && !isActive) return false;

  const result = entry.schema.safeParse(parsed);
  if (!result.success) {
    entry.onInvalid?.(result.error);
    return false;
  }
  entry.handle(result.data);
  return true;
}

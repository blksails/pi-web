/**
 * pending-requests — 「下发请求帧 → 按 id 配对结果帧」的在途请求表。
 *
 * ## 为什么抽出来
 *
 * `PiSession` 里原有三张**结构完全相同**的表 —— clearQueue / agent-routes /
 * attachment-catalog,`Map<string, { resolve; reject; timer }>`。三份各自写了登记、
 * 超时 reject、send 失败回滚、结果配对、收尾清空,共 22 处 `clearTimeout` 里的大半
 * 出自它们。原注释自己就写着「clearQueue 同构」「clearQueue/agent-routes 同构」——
 * 重复是被承认的,只是没有承载它的类型。
 *
 * ## 边界
 *
 * 只管**关联与生命周期**:发出去、等回来、超时、收尾。
 *  - 不认识帧格式(payload 由调用方在 `send` 里自行序列化);
 *  - 不认识会话状态(active 门由调用方在 issue 之前判定);
 *  - 不产生 id(由调用方生成并同时写进帧,避免此处与帧内 id 两处生成)。
 *
 * ⚠ **不要把 `pendingExtensionUI` 并进来**:那张表存的是「待人工响应的请求本身」
 * (`Map<string, RpcExtensionUIRequest>`),没有 promise 关联语义。形状相近而语义不同,
 * 合并只会让两个概念互相迁就。
 */

interface Entry<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** {@link PendingRequests.issue} 的入参。 */
export interface IssueOptions {
  /** 关联 id。调用方生成,并须与写进请求帧的 id 是**同一个值**。 */
  readonly id: string;
  /** 超时毫秒。 */
  readonly timeoutMs: number;
  /** 超时时用于 reject 的错误(惰性构造:不超时就不付构造代价,栈也更贴近超时现场)。 */
  readonly onTimeout: () => Error;
  /**
   * 下发请求帧。**同步**调用;抛错即视为下发失败 → 立即清理登记并 reject
   * (否则该请求会一直挂到超时才收敛)。
   */
  readonly send: () => void;
}

/**
 * 一类在途请求的登记表。`T` 是结果帧类型。
 *
 * 语义保证:
 *  - **迟到即丢弃**:`settle` 一个未知/已超时的 id 返回 `false`,不抛 —— 结果帧晚于
 *    超时到达是正常情形,不是错误;
 *  - **一次性**:同一 id 只会 settle 一次(settle 后即从表中摘除);
 *  - **收尾必收敛**:`rejectAll` 把所有在途请求 reject 并清表,避免会话结束后悬挂。
 */
export class PendingRequests<T> {
  private readonly entries = new Map<string, Entry<T>>();

  /** 登记并下发一次请求。 */
  issue(opts: IssueOptions): Promise<T> {
    const { id, timeoutMs, onTimeout, send } = opts;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(id);
        reject(onTimeout());
      }, timeoutMs);
      this.entries.set(id, { resolve, reject, timer });
      try {
        send();
      } catch (err) {
        this.entries.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 用结果 resolve 对应的在途请求。
   *
   * @returns 是否命中。`false` = 未知或已超时的 id(安全丢弃,调用方无需处理)。
   */
  settle(id: string, value: T): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.entries.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(value);
    return true;
  }

  /** reject 全部在途请求并清表(会话收尾)。`error` 惰性构造,每条各取一次。 */
  rejectAll(error: () => Error): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      entry.reject(error());
    }
    this.entries.clear();
  }

  /** 在途数量(诊断/测试用)。 */
  get size(): number {
    return this.entries.size;
  }
}

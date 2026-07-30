/**
 * session-meta — 会话展示元数据的**端口契约**(spec session-meta-index, Req 1.4 / 7.8)。
 *
 * 这顶「帽子」解决的问题:会话列表要显示标题与所属 agent-source,但
 *  - 标题在 fs 后端只能靠 `SessionEntryStore.displayName` **顺读整份 jsonl** 派生
 *    (见 `session-list/session-list-routes.ts` 的 enrichDisplayNames 注释);
 *  - agent-source 在会话持久化里**根本没有**落脚处(`SessionHeader`/`SessionMeta` 均无此字段),
 *    以致 `SessionListItem.source` 长期是个空壳字段——DTO 与 UI 都就绪,唯独没有数据源。
 *
 * 定位:**缓存,不是权威**。标题的权威仍是会话自身的历史(`session_info`);本索引丢失、损坏、
 * 写入失败时,调用方必须退回既有路径继续工作(Req 3.5)。因此端口的全部方法**绝不抛出**。
 *
 * 边界:本模块不认识任何持久化后端(不依赖 `SessionEntryStore`)。标题重建由调用方用既有派生
 * 路径完成后经 `merge` 回填(Req 3.6 / 9.7)。
 */

/**
 * 会话展示元数据条目。字段缺省即「未知」,**不编造默认值**。
 *
 * 刻意不含:任何会话正文派生字段(消息数、首条摘要等,Req 1.4)、任何运行时状态
 * (busy/lifecycle —— 落盘的活跃态在进程异常退出后会永久骗人,Req 7.8)。
 */
export interface SessionMetaEntry {
  /** 最近已知标题(权威在会话历史;此处为快读副本)。 */
  readonly title?: string;
  /** 所属 agent-source 稳定标识(来自 `ResolvedSource.policySource`)。 */
  readonly agentSource?: string;
  /** 最近一次写入时间(ISO)。仅供诊断与 prune 决策,不参与展示与排序。 */
  readonly updatedAt?: string;
}

/**
 * 会话展示元数据索引端口。
 *
 * **契约:所有方法绝不抛出** —— 失败一律等价于「无元数据」。这不是懒省事,而是 Req 3.5 的直接
 * 落实:元数据是展示增强,任何读写失败都不得改变会话能否被列出与恢复。调用方因此可以省掉
 * try/catch 包裹,但**必须**能处理「读到空」这一结果。
 */
export interface SessionMetaIndex {
  /**
   * 读取全量元数据。索引不存在 / 内容不可解析 / 版本不识 / 无权限 → 返回空 Map(Req 3.1/3.2)。
   * 单条目内某字段不合法只丢弃该字段,保留同条目其余字段与其他条目(Req 3.3)。
   * 永不返回部分写入的中间态(Req 4.2)。
   */
  read(): Promise<ReadonlyMap<string, SessionMetaEntry>>;
  /**
   * 字段级合并写入(patch 中缺省的字段保持原值,不整条覆盖)。
   * 同字段先后写入不同值时后写者赢(Req 4.4)。
   * 取不到写入机会(如并发抢锁超时)即**放弃本次写入**并保持已有元数据不变(Req 4.3)。
   */
  merge(sessionId: string, patch: SessionMetaEntry): Promise<void>;
  /** 移除单个会话的元数据条目(会话删除时调用,Req 5.1)。 */
  remove(sessionId: string): Promise<void>;
  /**
   * 只保留给定会话标识集合的条目,清除其余残留;返回被清除的条目数(Req 5.3)。
   * 用于对齐「索引键」与「实际存在的会话」——索引对会话是**弱引用**,残留不影响列表
   * (列表以实际会话为准,Req 5.2),但需要有手段防止无界增长。
   */
  prune(existingSessionIds: Iterable<string>): Promise<number>;
}

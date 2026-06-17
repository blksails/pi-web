/**
 * useBranches — 消息分支 / 多版本切换(Req 8.1–8.4)。
 *
 * 本期仅线性同级版本切换(不做完整 fork 树):
 * - createBranch(entryId) → PiClient.fork(sessionId, { entryId }) 创建同级版本(Req 8.2)。
 * - select(entryId, index) → PiClient.getForkMessages(sessionId) 加载分支序列后更新内部分支态(Req 8.3)。
 * - branchOf(entryId) 暴露 { entryId, index, total } 供 UI 渲染"第 N / 共 M"(Req 8.1)。
 * - available=false 时所有方法 no-op,UI 隐藏分支控件,退化为线性会话(Req 8.4)。
 *
 * available 由上层依据会话是否支持 fork/get_fork_messages 决定并经 options 传入。
 * 错误降级:fork/getForkMessages 抛错时记入 error 暴露,不抛出、不阻断对话。
 */
import { useCallback, useState } from "react";
import type { PiClient } from "../client/pi-client.js";

export interface BranchInfo {
  readonly entryId: string;
  readonly index: number;
  readonly total: number;
}

export interface UseBranchesOptions {
  readonly sessionId: string | undefined;
  readonly client?: PiClient;
  /** fork/get_fork_messages 是否在当前会话可用;false 时所有方法 no-op。 */
  readonly available: boolean;
}

export interface UseBranchesResult {
  /** fork/get_fork_messages 是否可用。 */
  readonly available: boolean;
  /** 返回某条消息的分支信息(第 index/共 total),未知则 undefined。 */
  branchOf(entryId: string): BranchInfo | undefined;
  /** 经 fork 创建同级版本(POST /fork)。available=false 时 no-op。 */
  createBranch(entryId: string): Promise<void>;
  /** 经 get_fork_messages 加载分支序列后切换到第 index 版本。available=false 时 no-op。 */
  select(entryId: string, index: number): Promise<void>;
  readonly pending: boolean;
  readonly error: unknown;
}

export function useBranches(opts: UseBranchesOptions): UseBranchesResult {
  const { sessionId, client, available } = opts;

  const [branches, setBranches] = useState<ReadonlyMap<string, BranchInfo>>(
    () => new Map(),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const branchOf = useCallback(
    (entryId: string): BranchInfo | undefined => branches.get(entryId),
    [branches],
  );

  const createBranch = useCallback(
    async (entryId: string): Promise<void> => {
      if (!available || client === undefined || sessionId === undefined) {
        return;
      }
      setPending(true);
      setError(undefined);
      try {
        await client.fork(sessionId, { entryId });
      } catch (err) {
        setError(err);
      } finally {
        setPending(false);
      }
    },
    [available, client, sessionId],
  );

  const select = useCallback(
    async (entryId: string, index: number): Promise<void> => {
      if (!available || client === undefined || sessionId === undefined) {
        return;
      }
      setPending(true);
      setError(undefined);
      try {
        const res = await client.getForkMessages(sessionId);
        const total = res.messages.length;
        setBranches((prev) => {
          const next = new Map(prev);
          next.set(entryId, { entryId, index, total });
          return next;
        });
      } catch (err) {
        setError(err);
      } finally {
        setPending(false);
      }
    },
    [available, client, sessionId],
  );

  return {
    available,
    branchOf,
    createBranch,
    select,
    pending,
    error,
  };
}

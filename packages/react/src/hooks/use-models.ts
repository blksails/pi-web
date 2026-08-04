/**
 * useModels — 可用模型列表(按 provider 分组)与当前模型切换。
 *
 * 懒加载:首次 ensureLoaded 时经 PiClient.getAvailableModels 拉取并缓存;按 Model.provider 分组。
 * 切换经 controls.setModel(若提供)或 PiClient.setModel,并维护当前选中。
 * 空列表 / 报错(如端点缺失 404)时 available=false,供 UI 隐藏/禁用模型选择器(优雅降级)。
 * 不变量:groups 仅来自 getAvailableModels,不含任何写死项。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { PiClient } from "../client/pi-client.js";
import type { UsePiControlsResult } from "./use-pi-controls.js";

export interface ModelItem {
  readonly provider: string;
  readonly modelId: string;
  readonly label?: string;
}

export interface ModelGroup {
  readonly provider: string;
  readonly models: ReadonlyArray<ModelItem>;
}

export interface ModelSelection {
  readonly provider: string;
  readonly modelId: string;
}

/**
 * 从会话快照的 `model`(`unknown`,实为 pi SDK `Model` 形状)提取 `{provider, modelId}`。
 * 形状不符(缺字段/非对象)时返回 undefined,不抛错(Req 11.8)。
 */
function extractModelSelection(model: unknown): ModelSelection | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const rec = model as Record<string, unknown>;
  const provider = rec.provider;
  const modelId = rec.id;
  if (typeof provider !== "string" || typeof modelId !== "string") {
    return undefined;
  }
  return { provider, modelId };
}

export interface UseModelsOptions {
  readonly sessionId: string | undefined;
  readonly client?: PiClient;
  /** 提供则切换经 controls.setModel(否则回退 PiClient.setModel)。 */
  readonly controls?: UsePiControlsResult;
}

export interface UseModelsResult {
  readonly groups: ReadonlyArray<ModelGroup>;
  readonly current: ModelSelection | undefined;
  /** get_available_models 是否可用且非空。 */
  readonly available: boolean;
  readonly pending: boolean;
  readonly error: unknown;
  /** 懒加载:首次调用拉取并缓存模型列表。 */
  ensureLoaded(): Promise<void>;
  /** 切换当前会话模型并更新选中。 */
  select(provider: string, modelId: string): Promise<void>;
}

/** 按 provider 分组,保持模型在 RPC 返回中的出现顺序。 */
function groupByProvider(
  models: ReadonlyArray<{
    readonly provider: string;
    readonly id: string;
    readonly name: string;
  }>,
): ReadonlyArray<ModelGroup> {
  const order: string[] = [];
  const map = new Map<string, ModelItem[]>();
  for (const m of models) {
    let bucket = map.get(m.provider);
    if (bucket === undefined) {
      bucket = [];
      map.set(m.provider, bucket);
      order.push(m.provider);
    }
    bucket.push({ provider: m.provider, modelId: m.id, label: m.name });
  }
  return order.map((provider) => ({
    provider,
    models: map.get(provider) ?? [],
  }));
}

export function useModels(opts: UseModelsOptions): UseModelsResult {
  const { sessionId, client, controls } = opts;

  const [groups, setGroups] = useState<ReadonlyArray<ModelGroup>>([]);
  // 本地乐观态:select() 尚未回填会话快照前的即时反馈;快照有值时让位于快照(Req 11.8)。
  const [localCurrent, setLocalCurrent] = useState<ModelSelection | undefined>(
    undefined,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [loaded, setLoaded] = useState(false);

  // 缓存哨兵:防止并发/重复 ensureLoaded 重复拉取。
  const loadedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | undefined>(undefined);

  const ensureLoaded = useCallback((): Promise<void> => {
    if (loadedRef.current) return Promise.resolve();
    if (inFlightRef.current !== undefined) return inFlightRef.current;
    if (client === undefined || sessionId === undefined) {
      return Promise.resolve();
    }

    const c = client;
    const id = sessionId;
    const p = (async (): Promise<void> => {
      setPending(true);
      setError(undefined);
      try {
        const res = await c.getAvailableModels(id);
        loadedRef.current = true;
        setLoaded(true);
        setGroups(groupByProvider(res.models));
      } catch (err) {
        setError(err);
        setGroups([]);
      } finally {
        setPending(false);
        inFlightRef.current = undefined;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, [client, sessionId]);

  const select = useCallback(
    async (provider: string, modelId: string): Promise<void> => {
      const req = { provider, modelId };
      if (controls !== undefined) {
        await controls.setModel(req);
      } else {
        if (client === undefined || sessionId === undefined) {
          throw new Error("useModels: client/sessionId unavailable");
        }
        await client.setModel(sessionId, req);
      }
      setLocalCurrent(req);
    },
    [controls, client, sessionId],
  );

  const available = useMemo(
    () => loaded && groups.length > 0,
    [loaded, groups],
  );

  // 权威来源:会话快照(pi-session 把 set_model 结果写入 snapshot.model,Req 11.8)。
  // 快照未知(尚无 controls / 尚未收到 session-state 帧)时才回退本地乐观态;
  // 快照给出的模型即便不在 groups 里也原样透出,不因不在清单中而消失(Req 11.9)。
  const sessionCurrent = useMemo(
    () => extractModelSelection(controls?.session?.model),
    [controls?.session?.model],
  );
  const current = sessionCurrent ?? localCurrent;

  return {
    groups,
    current,
    available,
    pending,
    error,
    ensureLoaded,
    select,
  };
}

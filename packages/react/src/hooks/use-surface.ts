/**
 * useSurface — agent 权威 surface(agent-authoritative-surface)前端 hook。
 *
 * 在既有 `ControlStore.states`(下行镜像)+ `createUiRpcBus`(命令上行)+ `getCommands`(能力探针)
 * 之上封装 `{ state, run, available, rev }`:
 *  - **state / rev**:镜像 `control:"state"` 帧中 `key="surface:<domain>"` 的快照(rev 守卫已在
 *    `ControlStore.applyControlFrame`);未收到任何该 domain 快照前 `state=null`。
 *  - **run(action, args?)**:经 ui-rpc bus 发 `{point:"command", action:"execute",
 *    payload:{domain, action, args}}`(payload 无顶层 `name` → 逃逸 host 拦截 → agent 转发);
 *    **不用** `client.uiRpcCommand`(host 同步路径)。结果按 correlationId 异步配对,`safeParse`
 *    为 `SurfaceCommandResult` 后 resolve。
 *  - **available**:挂载时经 `getCommands()` 查 `surface:<domain>` 是否存在;`false` → 调用方退化。
 *
 * 风格对齐 `useExtensionState` / `useExtensionUI`:经 usePiContext 取 client/baseUrl,经
 * `connection.controlStore` 订阅。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  SurfaceCommandResultSchema,
  surfaceStateKey,
  type SurfaceCommandResult,
} from "@blksails/pi-web-protocol";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";
import { createUiRpcBus, type UiRpcBus } from "../web-ext/ui-rpc-bus.js";

export interface UseSurfaceOptions {
  readonly sessionId: string | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client?: PiClient;
  readonly baseUrl?: string;
  /** 测试/复用:注入 ui-rpc bus(否则据 client/connection 构造)。 */
  readonly bus?: UiRpcBus;
  /**
   * 测试/复用:注入已知命令名集合(否则挂载时经 `client.getCommands` 拉取)。
   * 含 `surface:<domain>` → `available=true`。
   */
  readonly commandNames?: readonly string[];
}

export interface UseSurfaceResult<S> {
  /** 当前镜像快照;未收到任何该 domain 快照前为 null。 */
  readonly state: S | null;
  /** 发起 surface 命令(经 agent 转发路径),resolve 为 SurfaceCommandResult。 */
  run(action: string, args?: unknown): Promise<SurfaceCommandResult>;
  /** 探针命令 `surface:<domain>` 是否存在 → 能力可用。 */
  readonly available: boolean;
  /** 当前镜像快照的修订号(未就绪为 -1)。 */
  readonly rev: number;
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

export function useSurface<S = unknown>(
  domain: string,
  opts: UseSurfaceOptions,
): UseSurfaceResult<S> {
  const ctx = usePiContext();
  const key = surfaceStateKey(domain);

  const client = useMemo<PiClient | undefined>(() => {
    if (opts.client !== undefined) return opts.client;
    if (ctx !== null && opts.baseUrl === undefined) return ctx.client;
    const baseUrl = opts.baseUrl ?? ctx?.baseUrl;
    if (baseUrl === undefined) return undefined;
    return createPiClient(baseUrl, ctx?.fetchImpl);
  }, [opts.client, opts.baseUrl, ctx]);

  const connection = opts.connection;
  const sessionId = opts.sessionId;

  // 下行镜像:订阅 ControlStore.states 切片。
  const snapshot = useSyncExternalStore(
    connection?.controlStore.subscribe ?? NO_SUBSCRIBE,
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
  );
  const entry = snapshot?.states[key];
  const state = (entry === undefined ? null : (entry.value as S)) as S | null;
  const rev = entry?.rev ?? -1;

  // ui-rpc bus:注入优先;否则据 client/connection 构造并在卸载时释放。
  const ownBus = useMemo<UiRpcBus | undefined>(() => {
    if (opts.bus !== undefined) return undefined; // 使用注入 bus,不自建
    if (client === undefined || sessionId === undefined || connection === undefined) {
      return undefined;
    }
    return createUiRpcBus({
      send: (req) => client.uiRpc(sessionId, req).then(() => undefined),
      subscribeResponse: connection.controlStore.onUiRpcResponse,
    });
  }, [opts.bus, client, sessionId, connection]);
  useEffect(() => {
    return () => {
      ownBus?.dispose();
    };
  }, [ownBus]);
  const bus = opts.bus ?? ownBus;

  const run = useCallback(
    async (action: string, args?: unknown): Promise<SurfaceCommandResult> => {
      if (bus === undefined) {
        return {
          domain,
          action,
          ok: false,
          error: { code: "unavailable", message: "surface ui-rpc bus unavailable" },
        };
      }
      const response = await bus.request({
        point: "command",
        action: "execute",
        payload: { domain, action, args },
      });
      const parsed = SurfaceCommandResultSchema.safeParse(response.result);
      if (parsed.success) return parsed.data;
      // bus 侧结算(TIMEOUT / SEND_FAILED / ABORTED / DISPOSED)或畸形 result → 归一化为 ok:false。
      return {
        domain,
        action,
        ok: false,
        error: response.error ?? {
          code: "invalid_result",
          message: "surface command result malformed",
        },
      };
    },
    [bus, domain],
  );

  // 能力探针:注入 commandNames 优先;否则挂载时拉取 getCommands。
  const [fetchedNames, setFetchedNames] = useState<readonly string[] | undefined>(undefined);
  const names = opts.commandNames ?? fetchedNames;
  useEffect(() => {
    if (opts.commandNames !== undefined) return; // 注入模式:不拉取
    if (client === undefined || sessionId === undefined) return;
    let cancelled = false;
    void client
      .getCommands(sessionId)
      .then((res) => {
        if (!cancelled) setFetchedNames(res.commands.map((c) => c.name));
      })
      .catch(() => {
        if (!cancelled) setFetchedNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [opts.commandNames, client, sessionId]);
  const available = names !== undefined && names.includes(key);

  return { state, run, available, rev };
}

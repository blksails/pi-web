/**
 * usePiControls — pi 控制能力(model / thinking / abort / steer / followUp / stats / commands)。
 *
 * 经 client 调 REST;各操作暴露 pending/success/error 态;stats 兼合 SSE control 旁路快照;
 * 这些控制不写入 useChat 消息流。
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  SteerRequest,
  SetModelRequest,
  SetThinkingRequest,
  GetStatsResponse,
  GetCommandsResponse,
  RpcSlashCommand,
  SessionSnapshot,
  SessionStats,
  ClearQueueResponse,
} from "@blksails/pi-web-protocol";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";
import type {
  SessionLifecycleSnapshot,
  QueueSnapshot,
} from "../sse/control-store.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";

/** 会话未建立连接 / 未收到任何 session-status 帧时的失败安全默认(不可发送)。 */
const DEFAULT_LIFECYCLE: SessionLifecycleSnapshot = {
  state: "initializing",
  detail: undefined,
  code: undefined,
};

export interface OperationState {
  readonly pending: boolean;
  readonly error: unknown;
}

const IDLE: OperationState = { pending: false, error: undefined };

/** 稳定空队列引用(无连接/无帧时的回退,避免每次渲染换引用)。 */
const EMPTY_QUEUE_SNAPSHOT: QueueSnapshot = { steering: [], followUp: [] };

export type ControlOperation =
  | "setModel"
  | "setThinking"
  | "abort"
  | "steer"
  | "followUp"
  | "clearQueue"
  | "getStats"
  | "getCommands";

export interface UsePiControlsOptions {
  readonly sessionId: string | undefined;
  readonly client?: PiClient;
  readonly baseUrl?: string;
  /** 连接对象;提供则 stats 兼合其 control 旁路快照。 */
  readonly connection?: PiSessionConnection | undefined;
}

export interface UsePiControlsResult {
  setModel(req: SetModelRequest): Promise<void>;
  setThinking(req: SetThinkingRequest): Promise<void>;
  abort(): Promise<void>;
  steer(req: SteerRequest): Promise<void>;
  followUp(req: SteerRequest): Promise<void>;
  /** 清空排队消息并返回被清 steering/followUp 文本(取回)。 */
  clearQueue(): Promise<ClearQueueResponse>;
  getStats(): Promise<GetStatsResponse>;
  getCommands(): Promise<GetCommandsResponse>;
  /** 兼合 REST + SSE 旁路的会话统计。 */
  readonly stats: SessionStats | undefined;
  readonly commands: readonly RpcSlashCommand[] | undefined;
  readonly state: Readonly<Record<ControlOperation, OperationState>>;
  /** 会话生命周期态(session-readiness-handshake);供门控发送/呈现连接态。 */
  readonly lifecycle: SessionLifecycleSnapshot;
  /** 轮次是否进行中(权威 busy,来自 session-state 快照);无快照时 false(session-snapshot-authority)。 */
  readonly busy: boolean;
  /** 服务端权威会话快照;收到 session-state 帧前为 undefined。 */
  readonly session: SessionSnapshot | undefined;
  /** steering / follow-up 排队快照(message-queue-ui);无连接/无帧时为空。 */
  readonly queue: QueueSnapshot;
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

export function usePiControls(
  opts: UsePiControlsOptions,
): UsePiControlsResult {
  const ctx = usePiContext();
  const client = useMemo<PiClient | undefined>(() => {
    if (opts.client !== undefined) return opts.client;
    if (ctx !== null && opts.baseUrl === undefined) return ctx.client;
    const baseUrl = opts.baseUrl ?? ctx?.baseUrl;
    if (baseUrl === undefined) return undefined;
    return createPiClient(baseUrl, ctx?.fetchImpl);
  }, [opts.client, opts.baseUrl, ctx]);

  const [state, setState] = useState<
    Record<ControlOperation, OperationState>
  >({
    setModel: IDLE,
    setThinking: IDLE,
    abort: IDLE,
    steer: IDLE,
    followUp: IDLE,
    clearQueue: IDLE,
    getStats: IDLE,
    getCommands: IDLE,
  });
  const [restStats, setRestStats] = useState<SessionStats | undefined>(
    undefined,
  );
  const [commands, setCommands] = useState<readonly RpcSlashCommand[] | undefined>(
    undefined,
  );

  // SSE 旁路 stats 快照(经 control store)。
  const connection = opts.connection;
  const controlSnapshot = useSyncExternalStore(
    connection?.controlStore.subscribe ?? NO_SUBSCRIBE,
    connection?.controlStore.getSnapshot ??
      ((): undefined => undefined),
    connection?.controlStore.getSnapshot ??
      ((): undefined => undefined),
  );
  const sseStats = controlSnapshot?.stats;

  const setOp = useCallback(
    (op: ControlOperation, next: OperationState): void => {
      setState((s) => ({ ...s, [op]: next }));
    },
    [],
  );

  const requireReady = useCallback((): {
    client: PiClient;
    sessionId: string;
  } => {
    if (client === undefined) throw new Error("usePiControls: client unavailable");
    if (opts.sessionId === undefined)
      throw new Error("usePiControls: sessionId unavailable");
    return { client, sessionId: opts.sessionId };
  }, [client, opts.sessionId]);

  const run = useCallback(
    async <T>(op: ControlOperation, fn: () => Promise<T>): Promise<T> => {
      setOp(op, { pending: true, error: undefined });
      try {
        const result = await fn();
        setOp(op, { pending: false, error: undefined });
        return result;
      } catch (err) {
        setOp(op, { pending: false, error: err });
        throw err;
      }
    },
    [setOp],
  );

  const sessionIdRef = useRef(opts.sessionId);
  sessionIdRef.current = opts.sessionId;

  const setModel = useCallback(
    (req: SetModelRequest): Promise<void> =>
      run("setModel", async () => {
        const { client: c, sessionId } = requireReady();
        await c.setModel(sessionId, req);
      }),
    [run, requireReady],
  );

  const setThinking = useCallback(
    (req: SetThinkingRequest): Promise<void> =>
      run("setThinking", async () => {
        const { client: c, sessionId } = requireReady();
        await c.setThinking(sessionId, req);
      }),
    [run, requireReady],
  );

  const abort = useCallback(
    (): Promise<void> =>
      run("abort", async () => {
        const { client: c, sessionId } = requireReady();
        await c.abort(sessionId);
      }),
    [run, requireReady],
  );

  const steer = useCallback(
    (req: SteerRequest): Promise<void> =>
      run("steer", async () => {
        const { client: c, sessionId } = requireReady();
        await c.steer(sessionId, req);
      }),
    [run, requireReady],
  );

  const followUp = useCallback(
    (req: SteerRequest): Promise<void> =>
      run("followUp", async () => {
        const { client: c, sessionId } = requireReady();
        await c.followUp(sessionId, req);
      }),
    [run, requireReady],
  );

  const clearQueue = useCallback(
    (): Promise<ClearQueueResponse> =>
      run("clearQueue", async () => {
        const { client: c, sessionId } = requireReady();
        return c.clearQueue(sessionId);
      }),
    [run, requireReady],
  );

  const getStats = useCallback(
    (): Promise<GetStatsResponse> =>
      run("getStats", async () => {
        const { client: c, sessionId } = requireReady();
        const res = await c.getStats(sessionId);
        setRestStats(res.stats);
        return res;
      }),
    [run, requireReady],
  );

  const getCommands = useCallback(
    (): Promise<GetCommandsResponse> =>
      run("getCommands", async () => {
        const { client: c, sessionId } = requireReady();
        const res = await c.getCommands(sessionId);
        setCommands(res.commands);
        return res;
      }),
    [run, requireReady],
  );

  // 权威 stats:优先取自 SSE 旁路快照(stats 帧 / session-state 同步,单一权威),
  // REST 拉取仅作首屏冷启动回退(Req 3.2/3.4)。
  const stats = sseStats ?? restStats;
  // 会话生命周期态:取自 control 旁路快照;无连接/无帧时回退失败安全默认(initializing)。
  const lifecycle = controlSnapshot?.lifecycle ?? DEFAULT_LIFECYCLE;
  // 权威 busy / 会话快照(session-snapshot-authority):前端纯投影,不再从 useChat.status 推断。
  const busy = controlSnapshot?.busy ?? false;
  const session = controlSnapshot?.session;
  // 排队快照(message-queue-ui):纯投影自 control:queue 帧;无连接/无帧回退空。
  const queue = controlSnapshot?.queue ?? EMPTY_QUEUE_SNAPSHOT;

  return {
    setModel,
    setThinking,
    abort,
    steer,
    followUp,
    clearQueue,
    getStats,
    getCommands,
    stats,
    commands,
    state,
    lifecycle,
    busy,
    session,
    queue,
  };
}

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
  SessionStats,
} from "@blksails/protocol";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";

export interface OperationState {
  readonly pending: boolean;
  readonly error: unknown;
}

const IDLE: OperationState = { pending: false, error: undefined };

export type ControlOperation =
  | "setModel"
  | "setThinking"
  | "abort"
  | "steer"
  | "followUp"
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
  getStats(): Promise<GetStatsResponse>;
  getCommands(): Promise<GetCommandsResponse>;
  /** 兼合 REST + SSE 旁路的会话统计。 */
  readonly stats: SessionStats | undefined;
  readonly commands: readonly RpcSlashCommand[] | undefined;
  readonly state: Readonly<Record<ControlOperation, OperationState>>;
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

  // SSE 旁路 stats 优先于(更新于)REST 拉取的 stats。
  const stats = sseStats ?? restStats;

  return {
    setModel,
    setThinking,
    abort,
    steer,
    followUp,
    getStats,
    getCommands,
    stats,
    commands,
    state,
  };
}

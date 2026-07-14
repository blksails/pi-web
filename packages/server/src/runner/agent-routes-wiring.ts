/**
 * agent-declared-routes · runner 子进程分发桥 `wireAgentRoutesBridge`(spec agent-declared-routes)。
 *
 * 两部分,均挂在父子 IPC 帧通道上:
 *
 *  1. **装配期声明帧**:归一化 `routes` 非空时,经装配期声明帧原语(runRpcMode 之前的 stdout 窗口)
 *     写一条 `{"type":"agent_routes",routes:[...]}` 帧——**纯数据投影**(name/methods/description),
 *     handler 函数绝不过进程边界。空声明零帧零注册,存量 source 零行为变化。
 *  2. **请求分发**:向帧通道注册 `piweb_agent_route_request` 帧,按 `name` 查进程内 handler registry →
 *     invoke handler(每帧独立 async,不排队);结果帧经 `ctx.send` 回流(fd1)。name 未注册 →
 *     `route_not_registered`;handler 抛错 → `handler_error`;返回值不可 JSON 序列化 → `handler_error`;
 *     **永不抛出**到 runner 主流程(不崩会话)。
 */
import {
  AgentRouteRequestFrameSchema,
  type AgentRouteDeclDto,
  type AgentRouteRequestFrame,
  type AgentRouteResultFrame,
  type AgentRoutesFrame,
} from "@blksails/pi-web-protocol";
import type {
  FrameChannel,
  HandlerCtx,
  WritableLike,
} from "./frame-channel/index.js";
import { emitAssemblyFrame } from "./frame-channel/index.js";
import type { NormalizedAgentRouteDecl } from "./agent-loader.js";

export interface WireAgentRoutesBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 归一化 routes(含 handler 引用,来自 agent-loader;无声明为 undefined)。 */
  readonly routes?: readonly NormalizedAgentRouteDecl[];
  /**
   * 装配期声明帧出口(默认 `process.stdout`,装配窗口);注入用于单测捕获。
   * 注:请求结果帧经帧通道 `ctx.send`(fd1)回流,不经此。
   */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface AgentRoutesBridgeWiring {
  /** 是否已接入帧通道(空声明恒 false)。 */
  readonly installed: boolean;
  /** 解绑注册(幂等)。 */
  cleanup(): void;
}

/** 归一化声明 → 纯数据投影(handler 字段剥除,不过进程边界)。 */
function toDeclDto(decl: NormalizedAgentRouteDecl): AgentRouteDeclDto {
  return {
    name: decl.name,
    methods: [...decl.methods],
    ...(decl.description !== undefined ? { description: decl.description } : {}),
  };
}

/**
 * 装配 agent-routes 分发桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**、
 * state/surface/clearQueue 三桥**之后**调用。
 *
 * 空声明(undefined / 空数组)→ 零帧、零注册、`installed:false`(存量 source 零行为变化)。
 */
export function wireAgentRoutesBridge(
  channel: FrameChannel,
  input: WireAgentRoutesBridgeInput,
): AgentRoutesBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const routes = input.routes ?? [];

  if (routes.length === 0) {
    return { installed: false, cleanup() {} };
  }

  // 装配期声明帧出口:注入优先,否则 process.stdout(装配窗口,runRpcMode 之前)。
  const declWrite: ((line: string) => void) | undefined =
    input.stdout !== undefined
      ? (line) => {
          input.stdout!.write(line);
        }
      : undefined;

  // 进程内 handler registry(name → 归一化声明;handler 只存活于此,不出进程)。
  const registry = new Map<string, NormalizedAgentRouteDecl>(
    routes.map((decl) => [decl.name, decl]),
  );

  // 装配期声明帧(纯数据投影,单次发射)。失败记诊断不抛(不阻断会话启动)。
  try {
    const frame: AgentRoutesFrame = {
      type: "agent_routes",
      routes: routes.map(toDeclDto),
    };
    emitAssemblyFrame(frame, declWrite);
  } catch (err) {
    stderr.write(
      `runner: agent-routes bridge declaration-frame error: ${String(err)}\n`,
    );
  }

  const emitResult = (ctx: HandlerCtx, result: AgentRouteResultFrame): void => {
    let payload: AgentRouteResultFrame = result;
    try {
      JSON.stringify(result); // 序列化探针
    } catch (err) {
      // handler 返回值不可 JSON 序列化(如循环引用)→ 归一化为 handler_error 回包,
      // 不悬挂主进程侧 pending(否则只能等 504)。
      payload = {
        type: "piweb_agent_route_result",
        id: result.id,
        ok: false,
        error: {
          code: "handler_error",
          message: `route result is not JSON-serializable: ${String(err)}`,
        },
      };
    }
    ctx.send(payload);
  };

  // 处理一条请求帧:查 registry → invoke handler → 归一化结果回写。永不抛出。
  const handleRequest = async (
    frame: AgentRouteRequestFrame,
    ctx: HandlerCtx,
  ): Promise<void> => {
    const entry = registry.get(frame.name);
    if (entry === undefined) {
      emitResult(ctx, {
        type: "piweb_agent_route_result",
        id: frame.id,
        ok: false,
        error: {
          code: "route_not_registered",
          message: `route not registered in this agent process: ${frame.name}`,
        },
      });
      return;
    }
    try {
      const value = await entry.handler({
        name: frame.name,
        method: frame.method,
        query: frame.query,
        ...(frame.body !== undefined ? { body: frame.body } : {}),
      });
      emitResult(ctx, {
        type: "piweb_agent_route_result",
        id: frame.id,
        ok: true,
        ...(value !== undefined ? { result: value } : {}),
      });
    } catch (err) {
      emitResult(ctx, {
        type: "piweb_agent_route_result",
        id: frame.id,
        ok: false,
        error: {
          code: "handler_error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const unregister = channel.register(
    "piweb_agent_route_request",
    AgentRouteRequestFrameSchema,
    (frame: AgentRouteRequestFrame, ctx) => handleRequest(frame, ctx),
  );

  let cleanedUp = false;
  return {
    installed: channel.installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unregister();
    },
  };
}

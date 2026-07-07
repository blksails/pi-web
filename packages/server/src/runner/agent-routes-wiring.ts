/**
 * agent-declared-routes · runner 子进程分发桥 `wireAgentRoutesBridge`
 * (spec agent-declared-routes, Task 2.2)。
 *
 * 三个既有先例的同族复制(不发明新机制):
 *
 *  1. **装配期声明帧**(slash_completions 同族):归一化 `routes` 非空时,经 stdout 写一条
 *     `{"type":"agent_routes",routes:[...]}` JSONL 帧——**纯数据投影**(name/methods/description),
 *     handler 函数绝不过进程边界(Req 4.4 的结构性保证)。空声明零帧零读取器,存量 source
 *     零行为变化(Req 1.1/7.2)。调用点在 `runRpcMode` **之前**,此窗口 stdout 仍归 pi-web
 *     子进程代码掌控,可用 `process.stdout.write`(slash-completions-wiring 先例)。
 *  2. **第二 stdin reader**(surface-wiring 同族):只消费 `piweb_agent_route_request` 帧,
 *     其余行(pi RPC 命令、他桥请求行、非 JSON)一律放行不干预。按 `name` 查进程内 handler
 *     registry → invoke handler(每帧独立 `void handle(...)`,async 并发不排队,Req 5.3)。
 *     name 未注册 → `ok:false, code:"route_not_registered"`(防御路径,正常不发生——主进程
 *     已按路由表 404);handler 抛错 → `ok:false, code:"handler_error"`;**永不抛出**到 runner
 *     主流程(不崩会话,Req 5.2)。
 *  3. **fd1 直写回流**(state/surface/clearQueue 桥同坑):结果帧单次原子 `fs.writeSync(1)`。
 *     ⚠ 不能用 `process.stdout.write`:pi 的 `runRpcMode` `takeOverStdout()` 会把它重定向到
 *     stderr;server 的 `PiRpcProcess` 读的是子进程 fd1,故运行期回写必须直写 fd1。
 *
 * 优雅降级(对齐 `wireStateBridge`):挂载失败 → 记诊断、能力降级、**不抛**。
 */
import { writeSync } from "node:fs";
import {
  AgentRouteRequestFrameSchema,
  type AgentRouteDeclDto,
  type AgentRouteRequestFrame,
  type AgentRouteResultFrame,
  type AgentRoutesFrame,
} from "@blksails/pi-web-protocol";
import { JsonlLineReader } from "../rpc-channel/jsonl-reader.js";
import type { NormalizedAgentRouteDecl } from "./agent-loader.js";

/** data 监听器签名。 */
type DataListener = (chunk: string | Buffer) => void;
type ListenerOp = (event: "data", listener: DataListener) => unknown;

/** 可读流的最小视图(便于测试注入)。 */
interface ReadableLike {
  on(event: "data", listener: DataListener): unknown;
  off?: ListenerOp;
  removeListener?: ListenerOp;
  setEncoding?(encoding: string): unknown;
}

/** 可写流的最小视图。 */
interface WritableLike {
  write(s: string): unknown;
}

export interface WireAgentRoutesBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 归一化 routes(含 handler 引用,来自 agent-loader;无声明为 undefined)。 */
  readonly routes?: readonly NormalizedAgentRouteDecl[];
  /** 请求帧入口(默认 process.stdin)。 */
  readonly stdin?: ReadableLike;
  /**
   * 帧出口(默认:声明帧走 `process.stdout.write`(装配窗口),结果帧直写 fd1)。
   * 注入后声明帧与结果帧都经此捕获(单测接缝)。
   */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface AgentRoutesBridgeWiring {
  /** stdin 请求读取器是否挂上(空声明不挂,恒 false)。 */
  readonly installed: boolean;
  /** 卸载 stdin 读取器(幂等)。 */
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
 * 空声明(undefined / 空数组)→ 零帧、零读取器、`installed:false`(存量 source 零行为变化)。
 */
export function wireAgentRoutesBridge(
  input: WireAgentRoutesBridgeInput,
): AgentRoutesBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const routes = input.routes ?? [];

  if (routes.length === 0) {
    return { installed: false, cleanup() {} };
  }

  // 声明帧写出:装配窗口(runRpcMode 前)stdout 仍可用;测试可经 input.stdout 注入捕获。
  const writeDeclarationLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          process.stdout.write(s);
        };

  // 结果帧写出:默认直写 fd1(绕 takeOverStdout);测试可经 input.stdout 注入捕获。单次原子写。
  const writeResultLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          writeSync(1, s);
        };

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
    writeDeclarationLine(JSON.stringify(frame) + "\n");
  } catch (err) {
    stderr.write(
      `runner: agent-routes bridge declaration-frame error: ${String(err)}\n`,
    );
  }

  const emitResult = (result: AgentRouteResultFrame): void => {
    let line: string;
    try {
      line = JSON.stringify(result) + "\n";
    } catch (err) {
      // handler 返回值不可 JSON 序列化(如循环引用)→ 归一化为 handler_error 回包,
      // 不悬挂主进程侧 pending(否则只能等 504)。
      const fallback: AgentRouteResultFrame = {
        type: "piweb_agent_route_result",
        id: result.id,
        ok: false,
        error: {
          code: "handler_error",
          message: `route result is not JSON-serializable: ${String(err)}`,
        },
      };
      line = JSON.stringify(fallback) + "\n";
    }
    try {
      writeResultLine(line);
    } catch (err) {
      stderr.write(
        `runner: agent-routes bridge result-line error: ${String(err)}\n`,
      );
    }
  };

  // 处理一条请求帧:查 registry → invoke handler → 归一化结果回写。永不抛出。
  const handleRequest = async (frame: AgentRouteRequestFrame): Promise<void> => {
    const entry = registry.get(frame.name);
    if (entry === undefined) {
      emitResult({
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
      emitResult({
        type: "piweb_agent_route_result",
        id: frame.id,
        ok: true,
        ...(value !== undefined ? { result: value } : {}),
      });
    } catch (err) {
      emitResult({
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

  const stdin = input.stdin ?? process.stdin;
  let installed = false;
  let onData: DataListener | undefined;
  try {
    stdin.setEncoding?.("utf8");
    const reader = new JsonlLineReader();
    onData = (chunk: string | Buffer): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of reader.push(text)) {
        let parsedLine: unknown;
        try {
          parsedLine = JSON.parse(line);
        } catch {
          continue; // 非 JSON(或 pi 命令的部分)— 与本桥无关,忽略
        }
        // 只消费请求帧;其余行(他桥/pi RPC/畸形帧)放行,不干预不回包。
        if (
          typeof parsedLine !== "object" ||
          parsedLine === null ||
          (parsedLine as { type?: unknown }).type !== "piweb_agent_route_request"
        ) {
          continue;
        }
        const req = AgentRouteRequestFrameSchema.safeParse(parsedLine);
        if (!req.success) continue; // 畸形请求帧 — 放行(主进程侧按超时收敛)
        // 每帧独立派发:async 并发,不排队不互斥(Req 5.3);错误就地吞掉(Req 5.2)。
        void handleRequest(req.data).catch((err) => {
          stderr.write(
            `runner: agent-routes bridge dispatch error: ${String(err)}\n`,
          );
        });
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(
      `runner: agent-routes bridge stdin reader install error: ${String(err)}\n`,
    );
  }

  let cleanedUp = false;
  return {
    installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined)
          stdin.removeListener("data", onData);
      }
    },
  };
}

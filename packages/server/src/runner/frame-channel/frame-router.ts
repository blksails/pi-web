/**
 * frame-channel · 单一入站帧通道(server↔runner 父子 IPC 多路复用器,Req 1/2/6/8)。
 *
 * 第一性表述:server(父)↔ runner(子)之间是**一条 IPC 通道**,承载 pi RPC 与 pi-web 自定义帧
 * 两层协议,按 `frame.type` 解复用。本通道取代原先四个入站桥各挂一个 `stdin.on("data")` + 各建一个
 * `JsonlLineReader` 的重复实现:对 `stdin` **只挂一个** data 读取器、**只维护一个** JSONL 行解析器
 * (复用既有 `rpc-channel/JsonlLineReader`,Req 7.4),按 type 查注册表分发。
 *
 * 关键语义:
 *  - **放行**:stdin 是广播(pi 的 `runRpcMode` 读取器与本通道读取器各自独立 `on("data")`,不独占)。
 *    未注册 type / 非 JSON / schema 失败的行,本通道**不消费不回包**即等于放行(pi 读取器已独立收到)。
 *  - **上行单出口**:handler 的 `ctx.send` 与通道 `send` 共用同一个 fd1 writer(`makeLineWriter`),
 *    handler 拿不到 `process.stdout`——结构上杜绝云上误路由到 log 通道(见 `line-writer.ts`)。
 *  - **优雅降级**:install 失败 → `installed:false` 不抛;handler 抛错 → catch 记诊断不外泄(Req 6.4)。
 */
import { JsonlLineReader } from "../../rpc-channel/jsonl-reader.js";
import { makeLineWriter } from "./line-writer.js";
import type { DataListener, ReadableLike, WritableLike } from "./stream-views.js";

/** 结构化 `safeParse` 视图(兼容 zod schema,避免直接耦合 zod 类型)。 */
export interface SafeParser<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false };
}

/** handler 上下文:唯一上行出口经统一 fd1 writer 发帧。 */
export interface HandlerCtx {
  /** 写出一帧(自动 `JSON.stringify` + 换行)。经统一 fd1 writer,是 handler 的唯一上行出口。 */
  send(frame: unknown): void;
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
}

/** 帧 handler:同步或异步;抛错由通道捕获,不外泄。 */
export type FrameHandler<T> = (frame: T, ctx: HandlerCtx) => void | Promise<void>;

/** 帧通道对外契约。 */
export interface FrameChannel {
  /**
   * 注册一个或多个 frame type → (schema, handler)。返回幂等解绑句柄。
   * 匹配 type 且 schema 通过时调用 handler;否则放行/丢弃。
   */
  register<T>(
    types: string | readonly string[],
    schema: SafeParser<T>,
    handler: FrameHandler<T>,
  ): () => void;
  /** 主动写一帧(用于 state 出站订阅下行帧)。经与 `ctx.send` 相同的 fd1 writer。 */
  send(frame: unknown): void;
  /** stdin 读取器是否挂上(install 失败为 false,降级)。 */
  readonly installed: boolean;
  /** 卸载 stdin 读取器 + 清空注册表(幂等)。 */
  cleanup(): void;
}

export interface CreateFrameChannelInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 命令行入口(默认 `process.stdin`)。 */
  readonly stdin?: ReadableLike;
  /** 上行行出口(默认真实 fd1;注入用于单测捕获)。 */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 `process.stderr`)。 */
  readonly stderr?: WritableLike;
}

interface RegistryEntry {
  readonly schema: SafeParser<unknown>;
  readonly handler: FrameHandler<unknown>;
}

/**
 * 装配单一入站帧通道。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**创建,
 * 并在此窗口完成所有 `register`。
 */
export function createInboundFrameRouter(
  input: CreateFrameChannelInput,
): FrameChannel {
  const stderr = input.stderr ?? process.stderr;
  const writeLine = makeLineWriter(input.stdout);

  const send = (frame: unknown): void => {
    try {
      writeLine(JSON.stringify(frame) + "\n");
    } catch (err) {
      stderr.write(`runner: frame-channel send error: ${String(err)}\n`);
    }
  };

  const ctx: HandlerCtx = { send, sessionId: input.sessionId };

  const registry = new Map<string, RegistryEntry>();

  const dispatch = (type: string, parsed: unknown): void => {
    const entry = registry.get(type);
    if (entry === undefined) return; // 未注册 → 放行(pi 读取器独立处理)
    const res = entry.schema.safeParse(parsed);
    if (!res.success) return; // schema 失败 → 丢弃畸形行(不调 handler,不抛)
    try {
      const maybe = entry.handler(res.data, ctx);
      // handler 可同步或异步;async 拒绝在此收敛,不外泄。
      void Promise.resolve(maybe).catch((err) => {
        stderr.write(
          `runner: frame-channel handler error [${type}]: ${String(err)}\n`,
        );
      });
    } catch (err) {
      // 同步抛错。
      stderr.write(
        `runner: frame-channel handler error [${type}]: ${String(err)}\n`,
      );
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
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // 非 JSON(或 pi 命令的部分)— 与本通道无关,放行
        }
        if (typeof parsed !== "object" || parsed === null) continue;
        const type = (parsed as { type?: unknown }).type;
        if (typeof type !== "string") continue;
        dispatch(type, parsed);
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(
      `runner: frame-channel stdin reader install error: ${String(err)}\n`,
    );
  }

  let cleanedUp = false;
  return {
    register<T>(
      types: string | readonly string[],
      schema: SafeParser<T>,
      handler: FrameHandler<T>,
    ): () => void {
      const list = typeof types === "string" ? [types] : [...types];
      const entry: RegistryEntry = {
        schema: schema as SafeParser<unknown>,
        handler: handler as FrameHandler<unknown>,
      };
      for (const t of list) registry.set(t, entry);
      let unregistered = false;
      return () => {
        if (unregistered) return;
        unregistered = true;
        for (const t of list) {
          if (registry.get(t) === entry) registry.delete(t);
        }
      };
    },
    send,
    get installed() {
      return installed;
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      registry.clear();
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined)
          stdin.removeListener("data", onData);
      }
    },
  };
}

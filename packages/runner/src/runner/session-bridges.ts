/**
 * session-bridges — 会话接线的**统一契约与单一清单**。
 *
 * ## 问题
 *
 * 七个 `*-wiring.ts` 早已长成同一个形状(`WireXInput` + `XWiring{cleanup()}` + `wireX(...)`),
 * 但这个契约没有类型承载,于是 `startRunner` 只能逐个手工接线:一处 import、一段调用、
 * 再往 `disposeAll` 的数组里补一项 —— **加一个桥要改三处**,漏掉第三处的表现是
 * 「帧收得到、退出不回收」,只有 e2e 能抓。
 *
 * ## 解法
 *
 * 把那个已经存在的形状显式命名成 {@link SessionBridge},七个桥各出一个适配器(内部实现
 * 零改动),清单集中在 {@link SESSION_BRIDGES}。装配塌缩成一次遍历,`disposeAll` 的入参
 * 由遍历结果直接得到 —— **漏项在机制上不可能发生**。
 *
 * ★ 范式取自 `builtin-extensions.ts` 的 {@link BUILTIN_EXTENSIONS}:同一个「漏改一处即
 *   静默失效」的问题,内置扩展那条线已经用单一清单解过一次,本模块把接线这条线补齐。
 *
 * ## 顺序即装配序
 *
 * {@link SESSION_BRIDGES} 的数组顺序**就是**装配顺序,与改造前 `startRunner` 里的调用
 * 次序逐项一致,不可随意重排:
 *  - `state` 必须早于 `surface`(surface 命令内 `ctx.setState` 复用 state 的下行通道);
 *  - `attachment` 必须早于 `attachment-catalog`(后者经 {@link BridgeShared} 取前者的 store,
 *    以继承拓扑/profile 写路由)。
 */
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { ChildAttachmentStore } from "@blksails/pi-web-core/attachment-bridge/child-store.js";
import type { Disposable, FrameChannel } from "./frame-channel/index.js";
import type { NormalizedAgentRuntimeFactory } from "./agent-loader.js";
import { wireAttachmentBridge } from "./attachment-wiring.js";
import { wireStateBridge } from "./state-wiring.js";
import { wireSurfaceBridge } from "./surface-wiring.js";
import { wireClearQueueBridge } from "./clear-queue-wiring.js";
import { wireAgentRoutesBridge } from "./agent-routes-wiring.js";
import { wireAttachmentCatalogBridge } from "./attachment-catalog-wiring.js";
import { wireCredentialRefreshBridge } from "./credential-refresh-wiring.js";
import { isAttachmentProfileDisabled } from "./attachment-profile-wiring.js";

/**
 * 桥与桥之间**唯一**的真实依赖:catalog 桥要用 attachment 桥建好的 store。
 *
 * 刻意做成一个具名字段而非泛型 KV —— 依赖只有这一条,把它显式写出来比藏进
 * `get(key)/set(key)` 更诚实,也让「谁依赖谁」在类型上可见。新增跨桥依赖应当先问
 * 是否可以避免,确需引入时在此加字段(并在 {@link SESSION_BRIDGES} 的顺序上体现)。
 */
export interface BridgeShared {
  /** attachment 桥装配后填入;env 缺失(存储能力不可用)时保持 `undefined`。 */
  attachmentStore?: ChildAttachmentStore | undefined;
}

/** 装配一个会话桥所需的全部上下文。 */
export interface BridgeContext {
  /** 单一入站帧通道(已创建,尚未进入 `runRpcMode`)。 */
  readonly channel: FrameChannel;
  /** 由 `createAgentSessionRuntime` 建成的运行时。 */
  readonly runtime: AgentSessionRuntime;
  /** 当前会话 id(属主校验 + 诊断维度)。 */
  readonly sessionId: string;
  /** 归一化后的 agent 定义(routes / attachmentProfile / attachmentCatalog 声明源)。 */
  readonly factory: NormalizedAgentRuntimeFactory;
  /** 子进程 env(通常 `process.env`)。 */
  readonly env: NodeJS.ProcessEnv;
  /** 按 {@link SESSION_BRIDGES} 顺序在桥之间传递的可变槽位。 */
  readonly shared: BridgeShared;
}

/**
 * 一个会话桥。
 *
 * `wire` 返回 `undefined` 表示**本会话不装配**(无声明 / 能力未启用)—— 与各 wiring 既有的
 * 「零帧零注册」语义一致,调用方据此跳过收尾登记。
 */
export interface SessionBridge {
  /** 稳定标识,用于诊断日志(不参与任何行为判定)。 */
  readonly id: string;
  wire(ctx: BridgeContext): Disposable | undefined;
}

const attachmentBridge: SessionBridge = {
  id: "attachment",
  wire(ctx) {
    // writeProfile:关断优先于 agent 声明(agent-attachment-profile Req 5.1)。白名单校验
    // 已在 startRunner 装配期完成(未命中即进程退出),此处只做关断门控。
    const writeProfile = isAttachmentProfileDisabled(ctx.env)
      ? undefined
      : ctx.factory.attachmentProfile;
    const wiring = wireAttachmentBridge(ctx.runtime, {
      env: ctx.env,
      sessionId: ctx.sessionId,
      ...(writeProfile !== undefined ? { writeProfile } : {}),
    });
    ctx.shared.attachmentStore = wiring.store;
    return wiring;
  },
};

const stateBridge: SessionBridge = {
  id: "state",
  wire: (ctx) => wireStateBridge(ctx.channel, { sessionId: ctx.sessionId }),
};

const surfaceBridge: SessionBridge = {
  id: "surface",
  wire: (ctx) => wireSurfaceBridge(ctx.channel, { sessionId: ctx.sessionId }),
};

const clearQueueBridge: SessionBridge = {
  id: "clear-queue",
  wire: (ctx) =>
    wireClearQueueBridge(ctx.channel, ctx.runtime, { sessionId: ctx.sessionId }),
};

const agentRoutesBridge: SessionBridge = {
  id: "agent-routes",
  wire: (ctx) =>
    wireAgentRoutesBridge(ctx.channel, {
      sessionId: ctx.sessionId,
      ...(ctx.factory.routes !== undefined ? { routes: ctx.factory.routes } : {}),
    }),
};

const attachmentCatalogBridge: SessionBridge = {
  id: "attachment-catalog",
  wire: (ctx) =>
    wireAttachmentCatalogBridge({
      sessionId: ctx.sessionId,
      ...(ctx.factory.attachmentCatalog !== undefined
        ? { catalog: ctx.factory.attachmentCatalog }
        : {}),
      ...(ctx.shared.attachmentStore !== undefined
        ? { store: ctx.shared.attachmentStore }
        : {}),
    }),
};

const credentialRefreshBridge: SessionBridge = {
  id: "credential-refresh",
  wire: (ctx) => wireCredentialRefreshBridge(ctx.channel, { env: ctx.env }),
};

/**
 * 会话桥单一清单。**顺序即装配序**(见文件头「顺序即装配序」一节)。
 *
 * 新增一个桥 = 在此加一项 + 写一个适配器;`startRunner` 与收尾逻辑无需改动。
 */
export const SESSION_BRIDGES: readonly SessionBridge[] = [
  attachmentBridge,
  stateBridge,
  surfaceBridge,
  clearQueueBridge,
  agentRoutesBridge,
  attachmentCatalogBridge,
  credentialRefreshBridge,
];

/** {@link wireSessionBridges} 的结果。 */
export interface WiredSessionBridges {
  /** 已装配的接线(供 `disposeAll`;顺序同装配序)。 */
  readonly wirings: readonly Disposable[];
  /** 已装配的桥 id(诊断日志用;跳过的桥不出现)。 */
  readonly installed: readonly string[];
}

/**
 * 按清单顺序装配全部会话桥。
 *
 * 单个桥抛错不中断其余装配(与既有各 wiring「优雅降级、不阻断会话启动」的语义一致),
 * 诊断经 `onError` 上报。
 */
export function wireSessionBridges(
  ctx: BridgeContext,
  onError: (id: string, error: unknown) => void,
  bridges: readonly SessionBridge[] = SESSION_BRIDGES,
): WiredSessionBridges {
  const wirings: Disposable[] = [];
  const installed: string[] = [];
  for (const bridge of bridges) {
    try {
      const wiring = bridge.wire(ctx);
      if (wiring === undefined) continue;
      wirings.push(wiring);
      installed.push(bridge.id);
    } catch (error) {
      onError(bridge.id, error);
    }
  }
  return { wirings, installed };
}

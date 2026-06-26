/**
 * ctx.ui.custom 桥接 · runner 装配接线 `wireCustomUiBridge`
 * (spec ctx-ui-custom-bridge;Req 1.1, 1.2, 1.4, 4.1, 4.2, 4.3, 5.1, 5.2)。
 *
 * 背景:pi SDK 在 RPC 模式下 `ctx.ui.custom()` 是**空操作**(`dist/modes/rpc/rpc-mode.js`
 * 直接 `return undefined`,不发任何帧)。pi 把 uiContext 的绑定权交给 pi-web 传入的
 * `runtime.session`:`runRpcMode` 经 `session.bindExtensions({ uiContext, ... })` 绑定,且每次
 * `newSession/fork/switchSession` 后 `rebindSession` 会以**新建的 uiContext** 重绑(可能更换
 * session 对象)。
 *
 * 因此本模块**不改 pi 原码**,而是在 `runRpcMode` 之前 **patch session 类的 prototype 上的
 * `bindExtensions`**:每次 pi 绑定时,先把传入 `bindings.uiContext.custom` 替换为发帧实现,再
 * 委托原始 `bindExtensions`。patch 在 prototype 上 → 跨 rebind/换 session 对象一律生效(Req 4)。
 *
 * 覆盖的 `custom(factory, options)`:从 `options.__piWebCustomUi` 取可序列化 payload(注册名 +
 * props),合法 → 单次写一行 `extension_ui_request{method:"custom"}` JSONL 帧
 * (镜像 pi 的 notify fire-and-forget;主进程经 translateEvent 转译为 data-pi-custom-ui data part);
 * 非法/缺失 → 返回 undefined(保持 pi 空操作语义,Req 1.4/5.2)。不触碰 uiContext 其它方法。
 *
 * **关键:必须用 wire 时即时捕获的原始 stdout 写口**。pi 进入 RPC 模式后会 `takeOverStdout()`
 * (`dist/core/output-guard.js`)把 `process.stdout.write` 替换为**写 stderr** 的函数,真正的 RPC
 * 通道是它在接管时保存的原始 fd-1 写口(仅经内部 `writeRawStdout` 可达,且 pi 未公开导出)。
 * 因此若 override 在调用时才解析 `process.stdout.write`,帧会被导去 stderr、永不进 RPC 通道
 * (现象:帧出现在日志面板 `proc:stderr`,前端无渲染)。本模块在 `wireCustomUiBridge`(早于
 * `runRpcMode`/takeover)执行时**即时 `.bind` 捕获**当时仍为原始的 `process.stdout.write`,与 pi
 * 自身保存的 `rawStdoutWrite` 是同一个底层写口 → 帧直达 RPC 通道。
 *
 * 优雅降级:session prototype 不可达或无 `bindExtensions` → 不安装(custom 退回 pi 空操作),
 * 写 stderr 诊断,不抛(Req 5.1 不破坏既有启动)。
 */
import { randomUUID } from "node:crypto";

/** 约定:agent-kit `customUi` 经 pi `custom(factory, options)` 的 options 扩展字段透传 payload。 */
export const CUSTOM_UI_OPTIONS_KEY = "__piWebCustomUi";

/** ctx.ui.custom 的声明式渲染描述(注册名 + props),与协议 CustomUiPayload 同形。 */
export interface CustomUiPayload {
  readonly component: string;
  readonly props?: unknown;
}

/** 可注入的 stdout 写口(默认 `process.stdout`),便于测试隔离。 */
export interface StdoutLike {
  write(chunk: string): boolean;
}

/** pi uiContext 的最小可写视图(narrowing:pi 内层类型不可达,以同形本地接口操作)。 */
interface UiContextLike {
  custom?: (factory: unknown, options?: unknown) => Promise<unknown>;
  [key: string]: unknown;
}

/** pi `session.bindExtensions` 的入参最小形状(只取本模块消费的 uiContext)。 */
interface BindExtensionsBindings {
  uiContext?: UiContextLike;
  [key: string]: unknown;
}

type BindExtensionsFn = (bindings: BindExtensionsBindings) => unknown;

/** prototype 上 `bindExtensions` 的最小可写视图。 */
interface BindableSessionProto {
  bindExtensions?: BindExtensionsFn;
}

/** 幂等哨兵:标记 patched 的 `bindExtensions`,避免重复包装(多次 wire 调用安全)。 */
const PATCH_SENTINEL: unique symbol = Symbol.for("piWeb.customUi.bindExtensionsPatch");
type PatchedFn = BindExtensionsFn & {
  [PATCH_SENTINEL]?: { readonly original: BindExtensionsFn };
};

/** {@link wireCustomUiBridge} 入参(可注入 stdout / id 生成器,便于测试)。 */
export interface WireCustomUiBridgeInput {
  readonly stdout?: StdoutLike;
  readonly randomId?: () => string;
  /** 可选 stderr 诊断写口(默认 `process.stderr`)。 */
  readonly stderr?: StdoutLike;
}

/** {@link wireCustomUiBridge} 返回:还原入口(best-effort,用于测试/清理)。 */
export interface CustomUiBridgeWiring {
  /** 是否成功安装(prototype 可 patch)。 */
  readonly installed: boolean;
  /** 还原 prototype patch(若已安装),把 `bindExtensions` 复位为原始实现。 */
  readonly restore: () => void;
}

/** runtime 的最小视图:只需拿到 session 实例以取其 prototype。 */
interface RuntimeWithSession {
  readonly session: object;
}

/**
 * 校验并取出 options 上的 custom payload;非法/缺失返回 undefined(确定丢弃)。
 * 内联校验与协议 CustomUiPayloadSchema 同形(component 非空串);translateEvent 侧再校验一次。
 */
function readCustomUiPayload(options: unknown): CustomUiPayload | undefined {
  if (typeof options !== "object" || options === null) return undefined;
  const raw = (options as Record<string, unknown>)[CUSTOM_UI_OPTIONS_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const component = (raw as Record<string, unknown>)["component"];
  if (typeof component !== "string" || component.length === 0) return undefined;
  return { component, props: (raw as Record<string, unknown>)["props"] };
}

/** wire 时即时捕获的原始 stdout 写口(早于 pi takeOverStdout,故为真 RPC 通道)。 */
type RawWrite = (chunk: string) => boolean;

/** 构造覆盖的 `custom` 实现:合法 payload → 发一行 JSONL 帧;否则保持 pi 空操作语义。 */
function makeCustomOverride(
  rawWrite: RawWrite,
  randomId: () => string,
): (factory: unknown, options?: unknown) => Promise<unknown> {
  return function custom(_factory: unknown, options?: unknown): Promise<unknown> {
    const payload = readCustomUiPayload(options);
    if (payload !== undefined) {
      const frame = {
        type: "extension_ui_request",
        id: randomId(),
        method: "custom",
        payload: { component: payload.component, props: payload.props },
      };
      // 单次写整行 JSONL:同 stdout 流的多次 write 按 write() 调用序入队、整块入缓冲,
      // 不与 pi 自身写按字节交错(JSONL 按 \n 严格分行;JSON.stringify 转义 U+2028/2029)。
      // rawWrite 是 wire 时捕获的原始 fd-1 写口 —— 即使 pi 已 takeOverStdout 也直达 RPC 通道。
      rawWrite(`${JSON.stringify(frame)}\n`);
    }
    // fire-and-forget;与 pi RPC 模式 custom 一致返回 undefined。
    return Promise.resolve(undefined);
  };
}

/**
 * 在 `runRpcMode` 之前安装 custom 桥接:prototype-patch `session.bindExtensions`,
 * 使其每次绑定的 `uiContext.custom` 被替换为发帧实现(跨 rebind 生效)。
 *
 * @param runtime  `createAgentSessionRuntime` 返回的运行时(持有 `session`)。
 * @param input    可选 stdout / id 生成器 / stderr(测试注入)。
 * @returns        安装结果 + 还原入口;prototype 不可 patch 时优雅降级(installed:false)。
 */
export function wireCustomUiBridge(
  runtime: RuntimeWithSession,
  input: WireCustomUiBridgeInput = {},
): CustomUiBridgeWiring {
  const stdoutStream = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const randomId = input.randomId ?? (() => randomUUID());

  // **即时**绑定捕获当前 stdout 写口(此刻早于 pi runRpcMode 的 takeOverStdout,故仍是原始
  // fd-1 写口 = 真 RPC 通道)。若延迟到 override 调用时再取 process.stdout.write,会拿到被
  // takeover 替换成「写 stderr」的函数,帧将永不进 RPC 通道。
  const rawWrite = stdoutStream.write.bind(stdoutStream) as RawWrite;

  const proto = Object.getPrototypeOf(runtime.session) as
    | (BindableSessionProto & Record<string, unknown>)
    | null;

  if (proto === null || typeof proto.bindExtensions !== "function") {
    stderr.write(
      "runner: custom-ui bridge not installed (session prototype has no bindExtensions; custom UI disabled)\n",
    );
    return { installed: false, restore: () => {} };
  }

  const current = proto.bindExtensions as PatchedFn;
  // 幂等:已 patch 过则直接复用(多次 wire 调用 / 同 prototype 多 runtime 安全)。
  if (current[PATCH_SENTINEL] !== undefined) {
    return {
      installed: true,
      restore: () => {
        const meta = (proto.bindExtensions as PatchedFn)[PATCH_SENTINEL];
        if (meta !== undefined) proto.bindExtensions = meta.original;
      },
    };
  }

  const original = current;
  const override = makeCustomOverride(rawWrite, randomId);

  const patched: PatchedFn = function bindExtensions(
    this: unknown,
    bindings: BindExtensionsBindings,
  ): unknown {
    const ui = bindings?.uiContext;
    if (ui !== undefined && ui !== null && typeof ui === "object") {
      // 仅增强 custom;不触碰其它 uiContext 方法(Req 5.2)。
      ui.custom = override;
    }
    return original.call(this, bindings);
  };
  patched[PATCH_SENTINEL] = { original };
  proto.bindExtensions = patched;

  return {
    installed: true,
    restore: () => {
      if (proto.bindExtensions === patched) proto.bindExtensions = original;
    },
  };
}

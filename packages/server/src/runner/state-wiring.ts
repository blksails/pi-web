/**
 * 状态注入桥 · runner 子进程装配接线 `wireStateBridge`(state-injection-bridge)。
 *
 * 把 pi-web **自建**的会话级权威状态核(`SessionStateStore`)接到父子 IPC 帧通道与 globalThis
 * seam,实现 context 外的双向共享状态:
 *
 *  1. **seam 透出**:把 `{get,set,delete,snapshot}` provider 挂到 `__piWebSessionState__`,供运行在
 *     子进程的作者工具经 `@blksails/pi-web-tool-kit` 的 `getSessionState()` 同步读写。
 *  2. **下行(agent→UI)**:订阅状态核变更,经帧通道 `send` 写完整 `{"type":"piweb_state",…}` 行。
 *     server 的 `PiSession.handleRawLine` 截获翻译为 SSE `control:"state"` 帧(不进 LLM 历史)。
 *  3. **写回(UI→agent)**:向帧通道注册 `piweb_state_set` / `piweb_state_delete` 两类帧,改权威态
 *     (触发下行)。非本桥行由帧通道放行(pi 读取器独立处理)。
 *
 * 上行 fd1 直写、单一 stdin 读取器、优雅降级等横切件由帧通道统一承担(见 `frame-channel/`)。
 * 无订阅变更时不发任何帧(惰性)。
 */
import {
  StateSetLineSchema,
  type StateSetLine,
} from "@blksails/pi-web-protocol";
import type { FrameChannel, WritableLike } from "./frame-channel/index.js";
import { SESSION_STATE_SEAM_KEY } from "./frame-channel/index.js";
import {
  createSessionStateStore,
  type SessionStateStore,
} from "../state/session-state-store.js";

/** 约定 globalThis seam key(自 `frame-channel/seam-keys` 单一来源再导出,兼容既有引用)。 */
export { SESSION_STATE_SEAM_KEY };

/** seam 上挂载的 provider(tool-kit `getSessionState` 据此判形并代理)。 */
interface SeamProvider {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

export interface WireStateBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** globalThis 宿主(默认 globalThis),便于测试隔离。 */
  readonly globalScope?: Record<string, unknown>;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface StateBridgeWiring {
  /** 权威状态核(始终创建;降级时仍可用于进程内读写,只是不接 UI)。 */
  readonly store: SessionStateStore;
  /** 是否已接入帧通道(帧通道 stdin 读取器挂上)。 */
  readonly installed: boolean;
  /** 取消订阅 + 解绑注册 + 清 seam(幂等)。 */
  cleanup(): void;
}

/**
 * 装配状态桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**调用。
 *
 * @param channel 单一入站帧通道(承担 stdin 读取 / fd1 上行 / 降级)。
 * @param input   会话 id(+ 可选 seam 宿主 / stderr)。
 */
export function wireStateBridge(
  channel: FrameChannel,
  input: WireStateBridgeInput,
): StateBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const globalScope =
    input.globalScope ?? (globalThis as unknown as Record<string, unknown>);
  const store = createSessionStateStore();

  // 1) seam 透出:作者工具经 getSessionState() 读写;set/delete 走 store(触发下行)。
  const provider: SeamProvider = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    delete: (key) => {
      store.delete(key);
    },
    snapshot: () => {
      const out: Record<string, unknown> = {};
      for (const [k, entry] of store.snapshot()) out[k] = entry.value;
      return out;
    },
  };
  try {
    globalScope[SESSION_STATE_SEAM_KEY] = provider;
  } catch (err) {
    stderr.write(`runner: state-bridge seam install error: ${String(err)}\n`);
  }

  // 2) 下行:订阅变更 → 经帧通道 send 写完整 piweb_state 行(fd1)。无变更不发(惰性)。
  const unsubscribe = store.subscribe((change) => {
    channel.send({
      type: "piweb_state",
      key: change.key,
      value: change.value,
      rev: change.rev,
      ...(change.deleted ? { deleted: true } : {}),
    });
  });

  // 3) 写回:注册 piweb_state_set / piweb_state_delete。
  const unregister = channel.register(
    ["piweb_state_set", "piweb_state_delete"],
    StateSetLineSchema,
    (line: StateSetLine) => {
      if (line.type === "piweb_state_delete") {
        store.delete(line.key);
      } else {
        store.set(line.key, line.value);
      }
    },
  );

  let cleanedUp = false;
  return {
    store,
    installed: channel.installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribe();
      unregister();
      if (globalScope[SESSION_STATE_SEAM_KEY] === provider) {
        delete globalScope[SESSION_STATE_SEAM_KEY];
      }
    },
  };
}

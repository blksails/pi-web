/**
 * 标题持久化 · runner 装配接线 `wireSessionTitlePersistence`(spec auto-session-title, Req 8)。
 *
 * 背景:扩展(如自动标题扩展)经 `ctx.ui.setTitle(t)` 设置的标题,在 pi RPC 模式下只发一帧
 * `extension_ui_request{setTitle}` 驱动前端 **瞬态** `ambient.title`,**不写会话名**——故不出现在
 * 「会话历史」列表(列表读 session-store 的 `SessionMeta.name`)。而写会话名的 `appendSessionInfo`
 * 在扩展拿到的**只读** `ctx.sessionManager` 上不可达。
 *
 * 本模块以 **prototype-patch `session.bindExtensions`** 范式
 * 每次绑定时把 `bindings.uiContext.setTitle` 包装为「先调原 setTitle
 * (保留 ambient 帧展示)→ 再 best-effort `persistTitle(title)`」。`persistTitle` 由 runner 注入
 * (闭包到当前可写 `sessionManager.appendSessionInfo`),其写入经既有 `mirrorSessionManagerToStore`
 * 落 sqlite/postgres + pi 原生 fs,使会话历史显示标题并冷恢复后保留。
 *
 * 要点:
 *  - patch 在 prototype 上 → 跨 rebind/换 session 一律生效;persistTitle 经闭包取最新 SM。
 *  - 幂等哨兵避免重复包装(多次 wire / 多 runtime 共享 prototype 安全)。
 *  - 原 setTitle 与 persistTitle 各自 try/catch,互不影响、绝不抛出(Req 8.6)。
 */

/** runtime 的最小视图:只需拿到 session 实例以取其 prototype。 */
interface RuntimeWithSession {
  readonly session: object;
}

/** pi uiContext 的最小可写视图(只取本模块消费的 setTitle)。 */
interface UiContextLike {
  setTitle?: (title: string) => void;
}

/** `session.bindExtensions` 的入参最小形状。 */
interface BindExtensionsBindings {
  uiContext?: UiContextLike;
}

type BindExtensionsFn = (this: unknown, bindings: BindExtensionsBindings) => unknown;

/** prototype 上 `bindExtensions` 的最小可写视图。 */
interface BindableSessionProto {
  bindExtensions?: BindExtensionsFn;
}

/** 幂等哨兵:标记已 patch 的 `bindExtensions`,避免重复包装。 */
const PATCH_SENTINEL: unique symbol = Symbol.for("piWeb.sessionTitle.bindExtensionsPatch");
/** 幂等哨兵:标记已包装的 `setTitle`,避免对同一 uiContext 二次包装。 */
const WRAP_SENTINEL: unique symbol = Symbol.for("piWeb.sessionTitle.setTitleWrap");

type PatchedFn = BindExtensionsFn & { [PATCH_SENTINEL]?: { original: BindExtensionsFn } };
type WrappedSetTitle = ((title: string) => void) & { [WRAP_SENTINEL]?: true };

/**
 * 持久化标题为会话名的回调(由 runner 注入,best-effort)。
 *
 * 第二参 `session` 是**当前被绑定的 session 实例**(patched bindExtensions 里的 `this`)。runner
 * 据此取**当前** `sessionManager`(而非 runner 启动时捕获的旧实例)——进程内 `new_session`/
 * `switchSession`/`fork` 会换新 SessionManager,必须按 bind 时的 session 取,才写对会话(Req 8.3)。
 */
export type PersistTitle = (title: string, session: unknown) => void;

export interface WireSessionTitleInput {
  /** 测试注入的 stderr(默认 process.stderr)。 */
  stderr?: { write: (s: string) => unknown };
}

export interface SessionTitleWiring {
  /** 是否成功安装(prototype 无 bindExtensions 时为 false,优雅降级)。 */
  installed: boolean;
  /** 还原 prototype patch。 */
  restore: () => void;
}

/** 构造包装后的 setTitle:先原 setTitle(展示)→ 再 best-effort 持久化,两侧各自吞错。 */
function makeSetTitleWrap(
  original: ((title: string) => void) | undefined,
  persistTitle: PersistTitle,
  boundSession: unknown,
  stderr: { write: (s: string) => unknown },
): WrappedSetTitle {
  const wrapped: WrappedSetTitle = function setTitle(title: string): void {
    // 1) 原 setTitle:保留既有 ambient.title 展示(失败不影响持久化)。
    try {
      original?.(title);
    } catch (err) {
      stderr.write(`runner: session-title original setTitle error: ${String(err)}\n`);
    }
    // 2) 持久化为会话名(传当前 bound session,使 runner 取**当前** SM;失败不抛,Req 8.6)。
    try {
      persistTitle(title, boundSession);
    } catch (err) {
      stderr.write(`runner: session-title persist error: ${String(err)}\n`);
    }
  };
  wrapped[WRAP_SENTINEL] = true;
  return wrapped;
}

/**
 * 安装标题持久化桥接:prototype-patch `session.bindExtensions`,使每次绑定的
 * `uiContext.setTitle` 被包装为「展示 + 持久化」。prototype 不可 patch 时优雅降级。
 *
 * @param runtime       `createAgentSessionRuntime` 返回的运行时(持有 `session`)。
 * @param persistTitle  持久化回调(runner 闭包到可写 `sessionManager.appendSessionInfo`)。
 * @param input         可选 stderr(测试注入)。
 */
export function wireSessionTitlePersistence(
  runtime: RuntimeWithSession,
  persistTitle: PersistTitle,
  input: WireSessionTitleInput = {},
): SessionTitleWiring {
  const stderr = input.stderr ?? process.stderr;

  const proto = Object.getPrototypeOf(runtime.session) as
    | (BindableSessionProto & Record<string, unknown>)
    | null;

  if (proto === null || typeof proto.bindExtensions !== "function") {
    stderr.write(
      "runner: session-title persistence not installed (session prototype has no bindExtensions)\n",
    );
    return { installed: false, restore: () => {} };
  }

  const current = proto.bindExtensions as PatchedFn;
  // 幂等:已 patch 过则复用(同 prototype 多 runtime / 多次 wire 安全)。
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

  const patched: PatchedFn = function bindExtensions(
    this: unknown,
    bindings: BindExtensionsBindings,
  ): unknown {
    const ui = bindings?.uiContext;
    if (ui !== undefined && ui !== null && typeof ui === "object") {
      const existing = ui.setTitle as WrappedSetTitle | undefined;
      // 仅在未包装过时包装(避免对同一 uiContext 二次包装)。
      if (existing === undefined || existing[WRAP_SENTINEL] !== true) {
        const originalSetTitle =
          typeof existing === "function" ? existing.bind(ui) : undefined;
        // `this` = 当前被绑定的 session(进程内 new_session/switchSession 后为新 session),
        // 传给 persistTitle 以取**当前** SM,写对会话。
        ui.setTitle = makeSetTitleWrap(originalSetTitle, persistTitle, this, stderr);
      }
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

/**
 * GET /api/bootstrap — SPA 运行时配置端点(替代 Next server component 的 props 注入)。
 *
 * 取代两处构建期/服务端注入:
 *  1. `app/page.tsx` / `app/session/[id]/page.tsx` 读 `loadConfig()` 传给 <ChatApp> 的
 *     defaultSource / defaultModel / defaultCwd / autoStart。
 *  2. 15 个 `NEXT_PUBLIC_*` 门控 —— 在 Next 下是**构建期内联**(故 CLI 运行时设这些 env
 *     其实无效)。收进本端点后它们变成真正的运行时配置。
 *
 * `?sessionId=` 时附带该会话的 agent source 恢复结果(见 resolveResumeSource):
 * 冷加载 `/session/:id` 必须拿到它,否则刷新后 webext 扩展表面静默消失。
 * 该逻辑原在 `app/session/[id]/page.tsx` 的服务端组件里。
 *
 * Provider 密钥永不出现在响应里。
 */
import { loadConfig } from "../lib/app/config.js";
import { makeResumeMetaLoader } from "../lib/app/resume-meta.js";
import { lookupSessionSource } from "../lib/app/session-source-map.js";

/** 模块级单例:与 handler 复用同一 SESSION_STORE 后端,避免每请求重建句柄。 */
const loadResumeMeta = makeResumeMetaLoader();

function bool(v: string | undefined, dflt = false): boolean {
  if (v === undefined) return dflt;
  return v === "1" || v === "true";
}

/**
 * 构建期注入的 `@blksails/pi-web-kit` 真实版本(#33)。
 * 由 `scripts/build-server.mjs`(生产)与 `vite.config.ts`(dev/前端)两侧的 esbuild/vite
 * `define` 从 `packages/web-kit/package.json` 读出后内联。
 */
declare const __PI_WEB_KIT_VERSION__: string | undefined;

/**
 * 宿主自述的 web-kit 版本(#33)——**扩展兼容判定的输入**,见
 * `packages/react/src/web-ext/extension-gate.ts` 的 `isApiCompatible`。
 *
 * 取值次序:env 覆盖 → 构建期注入的真实版本。
 *
 * ★ env 在此**只是覆盖手段,不再提供默认值**。此前是 `env.X ?? "0.1.0"`:生产没设该 env,
 * 宿主便长期自称 0.1.0,而包实际已到 0.5.0。后果是「填对」与「填错」的结果相反 ——
 * 不设(自称 0.1.0)则按真实版本构建的扩展被拒;一旦有人"顺手"设成真实版本,所有存量
 * `^0.1.0` 扩展立刻全部被拒。根治办法是让宿主版本**来自包本身**,而不是靠人去对齐。
 */
export function resolveHostApiVersion(env: NodeJS.ProcessEnv): string {
  const override = env.NEXT_PUBLIC_PI_WEB_KIT_VERSION;
  if (override !== undefined && override.trim() !== "") return override;
  // 注入缺失只可能是构建配置被破坏(两侧 define 都没生效);此时宁可显式失败,
  // 也不要静默回落到某个硬编码版本 —— 那正是本缺陷的成因。
  if (typeof __PI_WEB_KIT_VERSION__ !== "string" || __PI_WEB_KIT_VERSION__ === "") {
    throw new Error(
      "[bootstrap] 宿主 web-kit 版本未注入:请检查 scripts/build-server.mjs 与 vite.config.ts 的 __PI_WEB_KIT_VERSION__ define",
    );
  }
  return __PI_WEB_KIT_VERSION__;
}

export interface BootstrapPayload {
  readonly defaultSource?: string;
  readonly defaultModel?: string;
  readonly defaultCwd: string;
  readonly autoStart: boolean;
  readonly multiTenant: boolean;
  readonly hostApiVersion: string;
  readonly features: Record<string, string | boolean>;
  readonly supabase?: { readonly url: string; readonly anonKey: string };
  /** `?sessionId=` 命中且能恢复时给出;供 webext registry 冷加载重解析扩展。 */
  readonly resumeSource?: string;
}

/**
 * 恢复会话的 agent source。主路径为 app 级 sessionId → source 映射(会话创建时由客户端
 * 记录,即便新会话尚无 header 也存在);回退到持久化的会话元数据(覆盖映射存在之前创建的
 * 会话)。读失败非致命 —— 会话仍可按 id 恢复。
 */
async function resolveResumeSource(id: string): Promise<string | undefined> {
  let source: string | undefined = await lookupSessionSource(id);
  if (source === undefined) {
    try {
      source = (await loadResumeMeta(id))?.source;
    } catch {
      source = undefined;
    }
  }
  return source;
}

export async function buildBootstrap(url: URL): Promise<BootstrapPayload> {
  const env = process.env;

  let defaultSource: string | undefined;
  let defaultModel: string | undefined;
  let defaultCwd = process.cwd();
  let autoStart = false;
  try {
    const config = loadConfig();
    defaultSource = config.defaultSource;
    defaultModel = config.defaultModel;
    defaultCwd = config.defaultCwd;
    autoStart = config.autoStart;
  } catch {
    // 与 app/page.tsx 同样的防御:缺 provider key 时仍渲染选源页,不泄漏底层错误。
    defaultSource = env.PI_WEB_DEFAULT_SOURCE;
    autoStart = env.PI_WEB_AUTOSTART === "1";
  }

  const multiTenant = env.PI_WEB_MULTI_TENANT === "1";
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const resumeSource =
    sessionId !== undefined ? await resolveResumeSource(sessionId) : undefined;

  return {
    ...(defaultSource !== undefined ? { defaultSource } : {}),
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    defaultCwd,
    autoStart,
    multiTenant,
    hostApiVersion: resolveHostApiVersion(env),
    features: {
      canvas: bool(env.NEXT_PUBLIC_PI_WEB_CANVAS),
      sourcePicker: bool(env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER),
      launcherRail: bool(env.NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL),
      bashEnabled: bool(env.NEXT_PUBLIC_PI_WEB_BASH_ENABLED),
      sessionsGlobal: bool(env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL),
      // 与 pi-handler 的服务端门控同语义:仅显式 false/0 才关。
      sessionsManage:
        env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "false" &&
        env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "0",
      sessionsSlot: env.NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT ?? "sidebar",
      extensionCommands: env.NEXT_PUBLIC_PI_EXTENSION_COMMANDS ?? "",
      extensionAllowlist: env.NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST ?? "",
      extensionBaseUrl: env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL ?? "",
      disableReadinessHandshake: bool(
        env.NEXT_PUBLIC_PI_WEB_DISABLE_READINESS_HANDSHAKE,
      ),
    },
    // 密钥仅在多租户开启时下发,且 anon key 本就是公开的浏览器端密钥。
    ...(multiTenant && supabaseUrl !== undefined && supabaseKey !== undefined
      ? { supabase: { url: supabaseUrl, anonKey: supabaseKey } }
      : {}),
    ...(resumeSource !== undefined ? { resumeSource } : {}),
  };
}

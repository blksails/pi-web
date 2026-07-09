/**
 * 前端功能门控的**运行时**来源(spec vite-spa-migration,Req 2.2)。
 *
 * 背景:这些门控原先经 `process.env.NEXT_PUBLIC_*` 读取,而 Next 对客户端组件里的
 * `NEXT_PUBLIC_*` 做**构建期内联** —— 意味着 CLI 用户在运行时设置它们其实**不生效**。
 *
 * SPA 化后由 `GET /api/bootstrap` 在服务端读取 env 并下发,前端经 `setRuntimeFeatures()`
 * 注入本模块。于是 `pi-web --canvas` 这类运行时开关终于能工作。
 *
 * 新旧宿主并存期:旧宿主(Next)不调用 `setRuntimeFeatures()`,`getRuntimeFeatures()` 回退到
 * env 读取,行为与迁移前逐字段一致。回退路径用 `typeof process` 守卫 —— 浏览器里 `process`
 * 是未定义标识符,直接访问会抛 ReferenceError。
 */

export interface RuntimeFeatures {
  readonly canvas: boolean;
  readonly sourcePicker: boolean;
  readonly launcherRail: boolean;
  readonly bashEnabled: boolean;
  readonly sessionsGlobal: boolean;
  readonly sessionsManage: boolean;
  readonly sessionsSlot: string;
  readonly extensionCommands: string;
  readonly extensionAllowlist: string;
  readonly extensionBaseUrl: string;
  readonly disableReadinessHandshake: boolean;
  readonly hostApiVersion: string;
}

let injected: RuntimeFeatures | undefined;

/** SPA 在配置到达后、渲染依赖门控的子树之前调用一次。 */
export function setRuntimeFeatures(features: RuntimeFeatures): void {
  injected = features;
}

/** 仅供测试:清除注入,回到 env 回退路径。 */
export function resetRuntimeFeatures(): void {
  injected = undefined;
}

/** 浏览器里 `process` 未定义;Node/Next 下返回真实 env。 */
function envRecord(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env !== undefined ? process.env : {};
}

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/** env 回退(旧宿主路径)。与迁移前 `chat-app.tsx` 的判定逐字段等价。 */
function envFeatures(): RuntimeFeatures {
  const env = envRecord();
  return {
    canvas: truthy(env.NEXT_PUBLIC_PI_WEB_CANVAS),
    sourcePicker: truthy(env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER),
    launcherRail: truthy(env.NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL),
    bashEnabled: truthy(env.NEXT_PUBLIC_PI_WEB_BASH_ENABLED),
    sessionsGlobal: truthy(env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL),
    // 默认启用;仅显式 false/0 关闭(与服务端同名门控一致)。
    sessionsManage:
      env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "false" &&
      env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "0",
    sessionsSlot: env.NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT ?? "sidebar",
    extensionCommands: env.NEXT_PUBLIC_PI_EXTENSION_COMMANDS ?? "",
    extensionAllowlist: env.NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST ?? "",
    extensionBaseUrl: env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL ?? "",
    disableReadinessHandshake: truthy(
      env.NEXT_PUBLIC_PI_WEB_DISABLE_READINESS_HANDSHAKE,
    ),
    hostApiVersion: env.NEXT_PUBLIC_PI_WEB_KIT_VERSION ?? "0.1.0",
  };
}

/** 注入优先;未注入(旧宿主)则回退 env。 */
export function getRuntimeFeatures(): RuntimeFeatures {
  return injected ?? envFeatures();
}

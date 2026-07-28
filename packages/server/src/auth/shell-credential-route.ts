/**
 * 壳凭据取回端点(spec: desktop-account-login,Req 12;方案 A)。
 *
 *   GET /desktop/credential   Authorization: Bearer <shell token>
 *     200 { credential }  —— 当前有有效登录态
 *     200 { credential: null } —— 未登录 / 已过期(不是错误,壳据此清钥匙串)
 *     401 —— token 缺失或不符
 *
 * ## 它为什么存在
 *
 * 钥匙串在 Rust 那侧,而唯一既有的写入口 `store_credential` 是 Tauri command ——
 * 只能由**渲染层** invoke,要求渲染层持有凭据明文,与 Req 8.2 冲突(webext 经原生
 * `import()` 加载,与登录 UI 同一个 JS realm,第三方 agent 扩展能读到 `window` 上的一切)。
 * 故需要一条「服务端 → 壳」且**绕开渲染层**的通道:壳带着只有它知道的 token 来取。
 *
 * ## ★ 三条纪律
 *
 * 1. **未配置 token 则整条路由不挂载**。`PI_WEB_SHELL_TOKEN` 由桌面壳每次启动随机生成
 *    并经子进程 env 下发;`pnpm dev` / npm CLI 下该 env 不存在,端点**根本不出现**
 *    (Req 12.7)。这不是"校验后拒绝",是"压根没有这个东西可打"。
 *
 * 2. **比对用定长时间算法**。朴素 `===` 会因短路而泄漏前缀匹配长度,使 token 可被逐字节
 *    试探出来。回环端点也不例外——本机恶意进程正是这个端点的威胁模型。
 *
 * 3. **未登录返回 200 + `credential: null`,不是 404**。壳据此把钥匙串条目清掉;
 *    若用 404,壳无法区分「没登录」与「端点不存在/版本不匹配」,只能保守什么都不做,
 *    于是登出后钥匙串里会残留上一次的凭据。
 *
 * ## 已知残留风险(设计时即接受,写在这里以免被误读为已解决)
 *
 * token 在壳进程的环境变量里,**同用户的其它进程读得到**,从而能取走凭据。
 * 本端点不声称能挡住同用户攻击者——那种攻击者本也能注入应用进程。它挡的是
 * 「任何本地进程随手 curl 一下就拿到凭据」。要彻底关掉需把服务端从 TCP 换成
 * 0600 的 Unix domain socket,那是另一个量级的改动。
 */
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import type { AuthSessionState } from "./auth-session-state.js";

/** 壳每次启动随机生成并经子进程 env 下发的取回 token。 */
export const SHELL_TOKEN_ENV = "PI_WEB_SHELL_TOKEN";

export interface ShellCredentialRoutesOptions {
  /** 进程内登录态(与鉴权端点、会话 spawn 同一实例)。 */
  readonly state: AuthSessionState;
  /** 期望的 token;由装配处从 env 解析。空值时调用方**不应**构造本路由。 */
  readonly token: string;
}

/**
 * 从 env 解析壳 token。
 *
 * @returns 未设置或为空 → `undefined`,装配处据此**不挂载**端点(Req 12.7)。
 */
export function resolveShellToken(env: NodeJS.ProcessEnv): string | undefined {
  const v = env[SHELL_TOKEN_ENV]?.trim();
  return v !== undefined && v.length > 0 ? v : undefined;
}

/**
 * 定长时间字符串比对。
 *
 * 不用 `crypto.timingSafeEqual`:它在长度不等时**抛异常**,那本身就泄漏了长度信息,
 * 且调用方还得包一层 try。此处先把长度差异折进异或结果,全程不短路。
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // 长度不同即判负,但仍走完整轮比对,不提前返回。
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function bearerOf(header: string | undefined | null): string | undefined {
  if (typeof header !== "string") return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim();
}

export function createShellCredentialRoutes(
  opts: ShellCredentialRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const { state, token } = opts;

  const get: InjectedRoute = {
    method: "GET",
    path: "/desktop/credential",
    handler: async (ctx) => {
      const presented = bearerOf(ctx.req.headers.get("authorization"));
      if (presented === undefined || !constantTimeEquals(presented, token)) {
        // 不区分「没带」与「带错」——区分开等于告诉试探者他离对答案有多近。
        return errorResponse(401, "UNAUTHORIZED", "Shell token required.");
      }
      // 未登录/已过期 → null(见纪律 3)。
      const credential = state.currentCredential() ?? null;
      return jsonResponse(200, { credential });
    },
  };

  return [get];
}

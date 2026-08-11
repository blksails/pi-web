/**
 * CloudLoginClient — 账号密码换桌面凭据(spec: desktop-account-login,任务 3.1;Req 2.1/2.3/2.4/8.1)。
 *
 * 只做一件事:打云端登录端点,把 HTTP 结果翻译成**失败类别**。不持有任何状态,
 * 不写日志中的任何凭据材料,不决定「登录成功后该做什么」——那是身份实现的事。
 *
 * ## 外部契约(实测确认,2026-07-27;本仓不拥有、不可改)
 *
 *   POST {loginUrl}  { email OR phone, password }
 *     200 → { token }        ← ★ 字段名是 `token`,不是 `credential`
 *     400 → "email and password required"
 *     401 → "Invalid login credentials"
 *     403 → 账号有效但无租户归属
 *
 * ★ **成功响应的字段名是 `token`**。首版按 `credential` 解,导致真机上「密码正确却报
 *   无法连接云端」—— 2xx 但字段对不上,落进了「响应形状非预期」分支。
 *   事实源是被撤回的 `7c184ed:packages/server/src/auth/signin-endpoint.ts`(那是本仓
 *   唯一跑通过成功路径的实现)。此处兼容 `token` 与 `credential` 两种字段名,
 *   以防云端将来改名 —— 但 `token` 是当前实测形态。
 *
 * ★ 云端**没有** device 授权端点(`/api/desktop/device`、`/api/auth/login` 等实测全 404)。
 *   仓内曾有注释称「device 授权流由 pi-cloud 承载」,那是过时推测,已在本 spec 更正。
 *
 * ## 脱敏纪律(Req 8.1)
 *
 * `password` 与响应体**绝不**进入 logger 的任何参数位置。日志只记结果与失败类别。
 * 这条由 `test/auth/cloud-login-client.test.ts` 的 logger 探针机械钉住 —— 光靠注释,
 * 下一个加调试日志的人会顺手把 body 打出来。
 */
import { createLogger } from "@blksails/pi-web-logger";

const logger = createLogger({ namespace: "server:auth:cloud-login" });

/**
 * 登录请求超时(毫秒)。
 *
 * ★ **不**复用 `CLOUD_LOGIN_MIN_TIMEOUT_MS`(90s)。那个下限的存在理由是「LLM 长响应
 * 不得被本地提前中断」,与登录毫无关系。登录是交互式请求 —— 让用户对着转圈等 90 秒,
 * 比早点告诉他「连不上,重试」要糟得多。
 */
export const CLOUD_LOGIN_REQUEST_TIMEOUT_MS = 15_000;

export type CloudLoginFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

/** 登录失败类别。与 `IdentityExchangeFailure` 的对应项同名同义,故意如此(直接透传)。 */
export type CloudLoginFailure =
  | "invalid-credentials"
  | "no-membership"
  | "invalid-request"
  | "cloud-unreachable";

export type CloudLoginResult =
  | { readonly ok: true; readonly credential: string }
  | { readonly ok: false; readonly reason: CloudLoginFailure };

export interface CloudLoginClientOptions {
  /** 完整 URL,如 `https://cloud.example/api/desktop/login`。 */
  readonly loginUrl: string;
  readonly fetchImpl?: CloudLoginFetch;
  /** 超时覆盖(测试用)。 */
  readonly timeoutMs?: number;
}

export interface CloudLoginInput {
  readonly email?: string;
  readonly phone?: string;
  readonly password: string;
}

export interface CloudLoginClient {
  /**
   * 用账号密码换取桌面凭据。
   *
   * @throws **不抛**。一切失败经 `{ ok:false, reason }` 表达 —— 调用方(身份实现)
   *         需要按类别分流出不同的用户文案,异常无法承载这个分类。
   */
  login(input: CloudLoginInput): Promise<CloudLoginResult>;
}

export function createCloudLoginClient(opts: CloudLoginClientOptions): CloudLoginClient {
  const timeoutMs = opts.timeoutMs ?? CLOUD_LOGIN_REQUEST_TIMEOUT_MS;
  const fetchImpl: CloudLoginFetch | undefined =
    opts.fetchImpl ??
    ((globalThis as { fetch?: CloudLoginFetch }).fetch as CloudLoginFetch | undefined);

  return {
    async login(input): Promise<CloudLoginResult> {
      const email = input.email?.trim();
      const phone = input.phone?.trim();
      // 密码**不** trim:前后空格可能是密码的一部分,擅自裁剪会让合法密码登不上。
      const password = input.password;
      if ((!email && !phone) || (email && phone) || password.length === 0) {
        return { ok: false, reason: "invalid-request" };
      }

      const url = opts.loginUrl.trim();
      if (url.length === 0 || fetchImpl === undefined) {
        logger.warn("cloud login unavailable", {
          hasUrl: url.length > 0,
          hasFetch: fetchImpl !== undefined,
        });
        return { ok: false, reason: "cloud-unreachable" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status: number;
      let text: string;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          // ★ 请求体在此处构造后即刻交出,不留引用、不进日志。
          body: JSON.stringify(email ? { email, password } : { phone, password }),
          signal: controller.signal,
        });
        status = res.status;
        text = await res.text();
      } catch {
        // 网络失败与超时不可分(AbortError 也走这里),对用户的处置相同:原样重试。
        logger.warn("cloud login request failed");
        return { ok: false, reason: "cloud-unreachable" };
      } finally {
        clearTimeout(timer);
      }

      if (status === 401) {
        logger.warn("cloud login rejected", { status });
        return { ok: false, reason: "invalid-credentials" };
      }
      if (status === 403) {
        // ★ 与 401 分开:账号密码是对的,是这个账号没有租户归属。让用户去改密码
        // 只会让他反复试同一个正确密码。用户该做的是换账号或找管理员开通。
        logger.warn("cloud login without membership", { status });
        return { ok: false, reason: "no-membership" };
      }
      if (status === 400 || status === 422) {
        logger.warn("cloud login bad request", { status });
        return { ok: false, reason: "invalid-request" };
      }
      if (status < 200 || status >= 300) {
        logger.warn("cloud login non-2xx", { status });
        return { ok: false, reason: "cloud-unreachable" };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        logger.warn("cloud login response is not JSON");
        return { ok: false, reason: "cloud-unreachable" };
      }
      // 云端实测返回 `token`;`credential` 作为兼容读位(见文件顶部★)。
      const obj =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { token?: unknown; credential?: unknown })
          : {};
      const credential = typeof obj.token === "string" ? obj.token : obj.credential;
      if (typeof credential !== "string" || credential.trim().length === 0) {
        // 响应形状非预期 —— 归入 cloud-unreachable 而非 invalid-credentials:
        // 用户的账号密码是对的(云端返回了 2xx),问题在服务端,重试可能成功。
        logger.warn("cloud login response missing credential");
        return { ok: false, reason: "cloud-unreachable" };
      }

      logger.info("cloud login succeeded");
      return { ok: true, credential: credential.trim() };
    },
  };
}

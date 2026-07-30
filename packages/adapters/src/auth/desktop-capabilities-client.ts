/**
 * DesktopCapabilitiesClient — 用桌面凭据换取能力授予
 * (spec: desktop-hybrid-agent-sources;desktop-account-login 任务 2.1 扩写)。
 *
 *  - POST capabilitiesUrl, Authorization: Bearer <desktop credential>
 *  - 解析 `tenant` / `egress` / `sources`
 *  - 进程内存缓存至到期前偏斜;token/凭据绝不落盘、不进 logger 参数
 *
 * ## ★ 本客户端有**两种失败语义**,且必须并存(design.md D3)
 *
 * | 方法 | 失败时 | 服务的场景 |
 * |---|---|---|
 * | {@link DesktopCapabilitiesClient.loadStatic} | **抛** | 登录路径。契约 §4.2「失败即拒绝」——授予拿不到就不得进入已登录态,否则产生「有凭据无授予」的半登录态 |
 * | {@link DesktopCapabilitiesClient.getSourcesGrant} | 返回 `undefined` | 源列表枚举。云端抖动时应退回仅本地源,而不是让侧栏整体报错 |
 *
 * 二者**不可统一**。把 `getSourcesGrant` 改成抛是回归(侧栏在云端抖动时崩);
 * 把 `loadStatic` 改成吞则会让伪造/失效凭据被当成「未启用」而静默放行登录。
 * 这正是 `../capability/types.ts` 顶部不变式 1 反复强调的那条线:
 * 「不可用」与「加载失败」必须可区分。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { SourcesGrant } from "@blksails/pi-web-core/agent-source-list/registry-http-provider.js";

/**
 * 发布授予(spec publish-grant-issuance)。在 sources 授予之上多两项**可展示**的身份:
 * `publisherId` 与 `org` —— 发布不可逆,得让用户看得见以谁的身份、在哪个命名空间下发。
 */
export interface PublishGrant {
  readonly baseUrl: string;
  /** ⚠ 凭据:禁止写盘/日志/任何其它载荷。 */
  readonly token: string;
  readonly publisherId: string;
  readonly org: string;
}

/**
 * 公钥登记结果(spec publish-key-lifecycle,Req 2.5)。
 *
 * 失败以**判别式**返回而非抛 —— 五种失败对调用方的含义不同:
 * `no-credential` / `no-grant` 是"本就没到能发布的阶段"(静默),
 * `conflict` 是"这把钥匙属于别人"(值得记),`network` / `bad-status` 是暂态。
 */
export type RegisterPublishKeyOutcome =
  | { readonly ok: true; readonly fingerprint: string; readonly publisherId: string }
  | {
      readonly ok: false;
      readonly kind: "no-credential" | "unauthorized" | "no-grant" | "conflict" | "network" | "bad-status";
    };
import type {
  CapabilityEgressGrant,
  CapabilityPublishGrant,
  CapabilityTenant,
  CapabilityTokenGrant,
  StaticCapabilitySnapshot,
} from "@blksails/pi-web-core/capability/types.js";
import type { EgressModel } from "@blksails/pi-web-core/capability/egress-model.js";

const logger = createLogger({ namespace: "server:auth:desktop-capabilities" });

/** 到期前多少秒强制刷新(时钟偏斜 + 传输延迟)。 */
const EXPIRY_SKEW_SECONDS = 30;

export type CapabilitiesFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export interface DesktopCapabilitiesClientOptions {
  /** 完整 URL,如 `https://cloud.example/api/desktop/capabilities`。 */
  readonly capabilitiesUrl: string;
  /** 当前有效桌面凭据;无/失效 → undefined。 */
  readonly getDesktopCredential: () => string | undefined;
  readonly fetchImpl?: CapabilitiesFetch;
  /** 测试注入时钟(毫秒)。 */
  readonly now?: () => number;
  /** 覆盖到期偏斜秒数(测试用)。 */
  readonly expirySkewSeconds?: number;
}

/** 能力端点整体加载失败(HTTP 层)。**只**由 `loadStatic()` 抛出。 */
export class CapabilitiesLoadError extends Error {
  constructor(
    /** 失败类别,便于调用方分流(未登录 / 鉴权被拒 / 网络 / 响应形状)。 */
    public readonly kind:
      | "no-credential"
      | "unauthorized"
      | "network"
      | "bad-status"
      | "bad-response",
    message: string,
  ) {
    super(message);
    this.name = "CapabilitiesLoadError";
  }
}

export interface DesktopCapabilitiesClient {
  /**
   * 取**静态能力快照**(tenant / egress / sources)。
   *
   * @throws {CapabilitiesLoadError} HTTP 层整体失败时抛(无凭据 / 401 / 网络 / 非 2xx /
   *         JSON 损坏)。契约 §4.2「失败即拒绝」:调用方此时不得进入已登录态。
   *
   * ⚠ **单项**授予解析失败**不**抛 —— 只使该字段缺失(契约 §4.2 不变式 1:字段缺失
   * 表示该能力不可用,消费方逐项降级)。「整体拿不到」与「其中一项没有」是两回事。
   *
   * @param credential 显式凭据。缺省时取 `getDesktopCredential()`。
   *        登录流程需要用**尚未写入进程登录态**的新凭据取授予(先拿到授予才落凭据,
   *        见 `identity/desktop-password-identity-provider.ts` 的顺序说明),故必须
   *        能显式传入 —— 否则调用方只能去临时改写共享登录态,那会让并发的
   *        `getSourcesGrant()` 在一瞬间用错身份。
   */
  loadStatic(credential?: string): Promise<StaticCapabilitySnapshot>;
  /**
   * **同步**读最近一次成功加载的快照;从不打网络。
   *
   * 存在理由:会话 spawn 的 env 组装是同步路径(`PiRpcProcess` 的 spec 构造),而那里
   * 需要 `egress` 授予以决定模型清单(Req 4.5)。把整条 spawn 链改成异步只为读一个
   * 已在内存里的值,不划算。
   *
   * @returns 缓存为空、已过期,或绑定的凭据已与当前不符 → `undefined`。
   *          ⚠ 返回 `undefined` **不**代表"没有授予",只代表"此刻缓存里没有" ——
   *          调用方须把它当作"退回本地默认",不得据此判定登录失败。
   */
  cachedStatic(): StaticCapabilitySnapshot | undefined;
  /**
   * 取 sources 授予;失败/未登录 → `undefined`。
   *
   * ★ **本方法必须继续吞掉一切异常。** 它服务于源列表枚举:云端抖动时正确行为是退回
   * 仅本地源,而不是让整个侧栏报错。若改成抛,登录状态下的一次云端 500 就会让用户
   * 连本地源都看不到 —— 那是明确的回归。需要 fail-hard 语义请用 {@link loadStatic}。
   */
  getSourcesGrant(): Promise<SourcesGrant | undefined>;
  /**
   * 取发布授予;失败/未登录/企业未配置 org → `undefined`。
   *
   * ★ 与 {@link getSourcesGrant} **同规:必须吞掉一切异常**。发布命令的正确降级是给出
   * 「该部署未接入发布身份」的失败卡片,而不是让整条命令抛成 500。
   *
   * ⚠ 返回 `undefined` 有三种成因(未登录 / 云端抖动 / 企业未配置 org),本方法**不区分** ——
   * 需要区分请读 {@link loadStatic} 的完整快照。
   */
  getPublishGrant(): Promise<PublishGrant | undefined>;
  /**
   * 把**本机公钥**登记到当前企业的 publisher 下(spec publish-key-lifecycle,Req 2)。
   *
   * ★ 与本客户端的其它 fail-soft 方法同规:**不抛**,失败以判别式返回。
   *   登记是"发布前的尽力而为",它失败不该让发布预览崩 —— 那会把一个可降级的问题
   *   升级成整条命令不可用。
   *
   * ⚠ 请求体只有 `{publicKey, label}`。归属由服务端从认证身份派生,**客户端无从指定** ——
   *   这是越权防线的结构性一环,不要在这里加 `publisherId` 之类的入参。
   */
  registerPublishKey(input: {
    readonly publicKey: string;
    readonly label: string;
  }): Promise<RegisterPublishKeyOutcome>;
  /** 清内存缓存(登出/切号时**必须**调用,否则下一个用户读到上一个用户的授予)。 */
  clearCache(): void;
}

interface CachedSnapshot {
  readonly snapshot: StaticCapabilitySnapshot;
  /** epoch 秒,到期时刻(已扣偏斜后的刷新阈值)。 */
  readonly refreshAfter: number;
  /** 绑定签发时使用的凭据,切号/登出时失效缓存。 */
  readonly credential: string;
}

function parseSourcesGrant(parsed: unknown): SourcesGrant | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const sources = (parsed as { sources?: unknown }).sources;
  if (typeof sources !== "object" || sources === null) return undefined;
  const obj = sources as { baseUrl?: unknown; token?: unknown; expiresAt?: unknown };
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  const token = typeof obj.token === "string" ? obj.token : "";
  if (baseUrl.length === 0 || token.length === 0) return undefined;
  return { baseUrl, token };
}

function parseExpiresAt(parsed: unknown, nowS: number): number {
  if (typeof parsed !== "object" || parsed === null) return nowS;
  const sources = (parsed as { sources?: unknown }).sources;
  if (typeof sources !== "object" || sources === null) return nowS;
  const exp = (sources as { expiresAt?: unknown }).expiresAt;
  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return exp;
  // 缺 expiresAt:短缓存 60s 避免每请求都打云。
  return nowS + 60;
}

/** 解析 `tenant`:三字段皆必填(契约:身份是完整的或根本没有),缺一即视为该能力不可用。 */
function parseTenant(parsed: unknown): CapabilityTenant | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const t = (parsed as { tenant?: unknown }).tenant;
  if (typeof t !== "object" || t === null) return undefined;
  const obj = t as { userId?: unknown; companyId?: unknown; role?: unknown };
  if (
    typeof obj.userId !== "string" ||
    typeof obj.companyId !== "string" ||
    typeof obj.role !== "string"
  ) {
    return undefined;
  }
  if (obj.userId.length === 0 || obj.companyId.length === 0) return undefined;
  // displayName 可选:云端 `profiles.name`。取不到就不带 —— 展示层退回 userId,
  // **不**因为缺一个展示用的名字而让整个身份不可用。
  const raw = (t as { displayName?: unknown; name?: unknown });
  const display =
    typeof raw.displayName === "string" && raw.displayName.trim().length > 0
      ? raw.displayName.trim()
      : typeof raw.name === "string" && raw.name.trim().length > 0
        ? raw.name.trim()
        : undefined;
  return {
    userId: obj.userId,
    companyId: obj.companyId,
    role: obj.role,
    ...(display !== undefined ? { displayName: display } : {}),
  };
}

/** 解析 egress 授予的模型清单。非数组或空数组 → 视为无可用模型(该能力不可用)。 */
function parseEgressModels(raw: unknown): ReadonlyArray<EgressModel> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const models: EgressModel[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim().length > 0) models.push({ id: entry.trim() });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      if (typeof obj.id !== "string" || obj.id.trim().length === 0) continue;
      const model: EgressModel = { id: obj.id.trim() };
      if (typeof obj.name === "string") (model as { name?: string }).name = obj.name;
      models.push(model);
    }
  }
  return models.length > 0 ? models : undefined;
}

function parseEgressGrant(
  parsed: unknown,
  nowS: number,
): CapabilityEgressGrant | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const e = (parsed as { egress?: unknown }).egress;
  if (typeof e !== "object" || e === null) return undefined;
  const obj = e as { baseUrl?: unknown; models?: unknown; expiresAt?: unknown };
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  if (baseUrl.length === 0) return undefined;
  const models = parseEgressModels(obj.models);
  if (models === undefined) return undefined;
  const expiresAt =
    typeof obj.expiresAt === "number" && Number.isFinite(obj.expiresAt) && obj.expiresAt > 0
      ? obj.expiresAt
      : nowS + 60;
  return { baseUrl, models, expiresAt };
}

function parseSourcesTokenGrant(
  parsed: unknown,
  nowS: number,
): CapabilityTokenGrant | undefined {
  const grant = parseSourcesGrant(parsed);
  if (grant === undefined) return undefined;
  return { ...grant, expiresAt: parseExpiresAt(parsed, nowS) };
}

/**
 * 解析 publish 授予(spec publish-grant-issuance Req 5.1)。
 *
 * ★ **四项缺一即整体作废**:`baseUrl`/`token`/`publisherId`/`org` 里少任何一个,
 *   拿到的都是一个「不知道以谁的身份、往哪个命名空间发」的半身份 —— 用它去发布只会在
 *   服务端以难懂的方式失败(FORBIDDEN),不如在此判为无授予,走既有的诚实降级。
 *
 * ⚠ 本函数**曾经缺失**:P1 给类型加了 `publish` 字段、也写了 `getPublishGrant()` 去读它,
 *   却没写这个解析器 —— 于是 `snapshot.publish` 恒 undefined,公钥登记永远静默跳过,
 *   真机上表现为"登录了也发不出去"。单测没抓到,是因为当时只用 stub 喂 `getPublishGrant()`,
 *   从没用**真实响应体**走过一遍解析(而隔壁 `sources` 正是那样测的)。
 */
function parsePublishGrant(parsed: unknown, nowS: number): CapabilityPublishGrant | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const publish = (parsed as { publish?: unknown }).publish;
  if (typeof publish !== "object" || publish === null) return undefined;
  const obj = publish as {
    baseUrl?: unknown;
    token?: unknown;
    publisherId?: unknown;
    org?: unknown;
    expiresAt?: unknown;
  };
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  const token = typeof obj.token === "string" ? obj.token : "";
  const publisherId = typeof obj.publisherId === "string" ? obj.publisherId.trim() : "";
  const org = typeof obj.org === "string" ? obj.org.trim() : "";
  if (baseUrl.length === 0 || token.length === 0 || publisherId.length === 0 || org.length === 0) {
    return undefined;
  }
  const expiresAt =
    typeof obj.expiresAt === "number" && Number.isFinite(obj.expiresAt)
      ? Math.floor(obj.expiresAt)
      : parseExpiresAt(parsed, nowS);
  return { baseUrl, token, publisherId, org, expiresAt };
}

/**
 * 从云登录 egress base 推导 capabilities URL。
 *
 * 例:`https://host/api/desktop/egress/v1` → `https://host/api/desktop/capabilities`
 * 无法识别时返回 undefined。
 */
export function deriveCapabilitiesUrlFromEgressBase(
  egressBaseUrl: string,
): string | undefined {
  const trimmed = egressBaseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return undefined;
  // 常见: .../api/desktop/egress/v1 或 .../api/desktop/egress
  const m = trimmed.match(/^(https?:\/\/.+?)\/api\/desktop\/egress(?:\/v\d+)?$/i);
  if (m !== null && m[1] !== undefined) {
    return `${m[1]}/api/desktop/capabilities`;
  }
  // 回退:去掉末段 /v1 后若以 /egress 结尾
  const withoutV = trimmed.replace(/\/v\d+$/i, "");
  if (/\/api\/desktop\/egress$/i.test(withoutV)) {
    return withoutV.replace(/\/egress$/i, "/capabilities");
  }
  return undefined;
}

/**
 * 从云登录 egress base 推导**账号密码登录** URL(spec: desktop-account-login,任务 2.3)。
 *
 * 例:`https://host/api/desktop/egress/v1` → `https://host/api/desktop/login`
 *
 * 推导而非新增配置项:云端地址已由 `desktop-cloud-login` Req 8 的 `cloud.egressBase`
 * 唯一确定,再加一个 loginUrl 配置只会制造「两处配置不一致」这一类故障。
 */
export function deriveLoginUrlFromEgressBase(egressBaseUrl: string): string | undefined {
  const capabilities = deriveCapabilitiesUrlFromEgressBase(egressBaseUrl);
  if (capabilities === undefined) return undefined;
  return capabilities.replace(/\/capabilities$/i, "/login");
}

/**
 * 解析 capabilities URL:`PI_WEB_CLOUD_CAPABILITIES_URL` 优先,否则由 egress base 推导。
 */
export function resolveDesktopCapabilitiesUrl(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const explicit = env.PI_WEB_CLOUD_CAPABILITIES_URL?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const egress = env.PI_WEB_CLOUD_LOGIN_EGRESS_BASE?.trim();
  if (egress === undefined || egress.length === 0) return undefined;
  return deriveCapabilitiesUrlFromEgressBase(egress);
}

export function createDesktopCapabilitiesClient(
  opts: DesktopCapabilitiesClientOptions,
): DesktopCapabilitiesClient {
  const now = opts.now ?? (() => Date.now());
  const skew = opts.expirySkewSeconds ?? EXPIRY_SKEW_SECONDS;
  const fetchImpl: CapabilitiesFetch | undefined =
    opts.fetchImpl ??
    ((globalThis as { fetch?: CapabilitiesFetch }).fetch as
      | CapabilitiesFetch
      | undefined);

  let cache: CachedSnapshot | undefined;

  /**
   * 单一取数实现。**失败一律抛** `CapabilitiesLoadError`;
   * fail-soft 的那一面由 `getSourcesGrant()` 在外层 catch(见接口注释的两语义表)。
   */
  async function loadStatic(credential?: string): Promise<StaticCapabilitySnapshot> {
    const cred = credential ?? opts.getDesktopCredential();
    if (cred === undefined || cred.trim().length === 0) {
      cache = undefined;
      throw new CapabilitiesLoadError("no-credential", "No valid desktop credential.");
    }

    const nowS = Math.floor(now() / 1000);
    if (cache !== undefined && cache.credential === cred && nowS < cache.refreshAfter) {
      return cache.snapshot;
    }

    if (fetchImpl === undefined) {
      throw new CapabilitiesLoadError("network", "No fetch implementation available.");
    }

    const url = opts.capabilitiesUrl.trim();
    if (url.length === 0) {
      throw new CapabilitiesLoadError("network", "Capabilities URL is empty.");
    }

    let status: number;
    let text: string;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${cred}`,
        },
        body: "{}",
      });
      status = res.status;
      text = await res.text();
    } catch {
      // 不记 url 之外的任何内容;凭据绝不进 logger 参数。
      logger.warn("capabilities request network failure");
      throw new CapabilitiesLoadError("network", "Capabilities request failed.");
    }

    if (status === 401 || status === 403) {
      cache = undefined;
      logger.warn("capabilities auth rejected", { status });
      throw new CapabilitiesLoadError("unauthorized", `Capabilities rejected (${status}).`);
    }
    if (status < 200 || status >= 300) {
      logger.warn("capabilities non-2xx", { status });
      throw new CapabilitiesLoadError("bad-status", `Capabilities returned ${status}.`);
    }

    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      logger.warn("capabilities invalid JSON");
      throw new CapabilitiesLoadError("bad-response", "Capabilities response is not JSON.");
    }

    // 逐项解析:任一项缺失只使该字段为 undefined,**不**使整体失败
    // (契约 §4.2 不变式 1 —— 消费方逐项降级)。
    const snapshot: StaticCapabilitySnapshot = {
      tenant: parseTenant(parsed),
      egress: parseEgressGrant(parsed, nowS),
      sources: parseSourcesTokenGrant(parsed, nowS),
      publish: parsePublishGrant(parsed, nowS),
    };

    // 缓存到最早到期的那一项之前;三项皆无则短缓存 60s,避免每次请求都打云端。
    // publish 也参与:它的 TTL 比 sources 短(发布凭据短时),漏算会让缓存在它过期后仍被复用。
    const expiries = [
      snapshot.egress?.expiresAt,
      snapshot.sources?.expiresAt,
      snapshot.publish?.expiresAt,
    ].filter(
      (x): x is number => typeof x === "number",
    );
    const earliest = expiries.length > 0 ? Math.min(...expiries) : nowS + 60;
    cache = {
      snapshot,
      refreshAfter: Math.max(nowS, earliest - skew),
      credential: cred,
    };
    return snapshot;
  }

  return {
    clearCache(): void {
      cache = undefined;
    },

    loadStatic,

    cachedStatic(): StaticCapabilitySnapshot | undefined {
      if (cache === undefined) return undefined;
      // 凭据必须与当前一致 —— 否则切号后的一次 spawn 会用上一个账号的出口。
      const cred = opts.getDesktopCredential();
      if (cred === undefined || cred !== cache.credential) return undefined;
      if (Math.floor(now() / 1000) >= cache.refreshAfter) return undefined;
      return cache.snapshot;
    },

    async getPublishGrant(): Promise<PublishGrant | undefined> {
      // 同 getSourcesGrant:catch 是刻意的,发布不可用应降级为失败卡片而非 500。
      let snapshot: StaticCapabilitySnapshot;
      try {
        snapshot = await loadStatic();
      } catch {
        return undefined;
      }
      const publish = snapshot.publish;
      if (publish === undefined) {
        // 不 warn:企业未配置 org 时缺席是**正常**状态,不是异常
        // (对比 sources 缺席 —— 那是配置问题,值得 warn)。
        return undefined;
      }
      return {
        baseUrl: publish.baseUrl,
        token: publish.token,
        publisherId: publish.publisherId,
        org: publish.org,
      };
    },

    async getSourcesGrant(): Promise<SourcesGrant | undefined> {
      // ★ 这里的 catch 是刻意的,不是遗漏。见接口注释:源列表枚举必须 fail-soft。
      let snapshot: StaticCapabilitySnapshot;
      try {
        snapshot = await loadStatic();
      } catch {
        return undefined;
      }
      const sources = snapshot.sources;
      if (sources === undefined) {
        logger.warn("capabilities response missing sources grant");
        return undefined;
      }
      return { baseUrl: sources.baseUrl, token: sources.token };
    },

    async registerPublishKey(input): Promise<RegisterPublishKeyOutcome> {
      const cred = opts.getDesktopCredential();
      if (cred === undefined || cred.trim().length === 0) return { ok: false, kind: "no-credential" };
      if (fetchImpl === undefined) return { ok: false, kind: "network" };

      const url = publishKeysUrlFrom(opts.capabilitiesUrl);
      if (url === undefined) return { ok: false, kind: "network" };

      let status: number;
      let text: string;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            // ★ 桌面凭据,**不是** publish grant 的 token —— 后者是发布面凭据,
            //   拿来做登记会扩大它的用途面。
            authorization: `Bearer ${cred}`,
          },
          body: JSON.stringify({ publicKey: input.publicKey, label: input.label }),
        });
        status = res.status;
        text = await res.text();
      } catch {
        logger.warn("publish key registration network failure");
        return { ok: false, kind: "network" };
      }

      if (status === 401 || status === 403) return { ok: false, kind: status === 401 ? "unauthorized" : "no-grant" };
      if (status === 409) return { ok: false, kind: "conflict" };
      if (status < 200 || status >= 300) {
        logger.warn("publish key registration rejected", { status });
        return { ok: false, kind: "bad-status" };
      }

      try {
        const body = JSON.parse(text) as { fingerprint?: unknown; publisherId?: unknown };
        if (typeof body.fingerprint !== "string" || typeof body.publisherId !== "string") {
          return { ok: false, kind: "bad-status" };
        }
        // 只记指纹(公开物),不记 publicKey 全文、不记凭据。
        logger.info("publish key registered", { fingerprint: body.fingerprint });
        return { ok: true, fingerprint: body.fingerprint, publisherId: body.publisherId };
      } catch {
        return { ok: false, kind: "bad-status" };
      }
    },
  };
}

/**
 * `.../api/desktop/capabilities` → `.../api/desktop/publish/keys`。
 *
 * 从 capabilities URL 推导而非另加一项配置:二者**必须同源同部署**,分成两个配置项就多了一种
 * "指向两个不同云端"的错误配置,而那种错配的表现是"登记成功但发布时说没这把钥匙"——极难定位。
 */
function publishKeysUrlFrom(capabilitiesUrl: string): string | undefined {
  const trimmed = capabilitiesUrl.trim();
  if (trimmed.length === 0) return undefined;
  const marker = "/capabilities";
  if (!trimmed.endsWith(marker)) return undefined;
  return `${trimmed.slice(0, -marker.length)}/publish/keys`;
}

/**
 * 身份获取端口 P5 —— 类型契约(spec: desktop-account-login,任务 1.1;Req 1.1-1.4)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6。本文件**只有类型**,无任何实现。
 *
 * ## 为什么需要这个端口
 *
 * P2 `CapabilityProvider` 定义了「**用身份换授予**」(`tenant`/`egress`/`sources`/`attachments`),
 * 却没有定义「**身份怎么来**」。桌面实现因此卡在起点:没有身份就拿不到任何授予,而契约
 * 里没有任何一处说明用户该如何取得身份。P5 补的正是这个缺口,与 P2 **正交**:
 *
 *   P5 答「身份怎么来」  →  P2 答「身份能换到什么」
 *
 * 两种宿主同口不同实现:桌面经账号密码向云端换取,云端多租户 web 的身份则由既有会话
 * 直接具备、**不需要**任何交互。故端口必须同时容纳这两种形态,且**调用方(装配层与 UI)
 * 不得据宿主类型分支** —— 一旦调用方写出 `if (isDesktop)`,两种实现就白抽象了。
 *
 * ## 三条不变式
 *
 *  1. **「身份不可得」是正常态,不是错误**(Req 1.6)。这是 P5 与 P2 最重要的语义差别:
 *     P2 已假定身份存在,故用抛错表达加载失败;P5 处在更前一步,「拿不到身份」正是它要
 *     表达的正常结果之一。若 {@link IdentityProvider.current} 也用抛错表达,`anonymous`
 *     与「探测失败」就不可分,而两者都应让宿主以未登录形态正常启动。
 *     故 `current()` 与 `exchange()` **均不抛**,失败一律经返回值表达。
 *
 *  2. **身份是完整的或根本没有**(Req 5.1)。{@link IdentityState} 是判别联合而非
 *     `{ authenticated: boolean; tenant?: … }` —— 后者允许表达 `{authenticated:true,
 *     tenant:undefined}` 这种非法组合,判别联合在编译期即消灭它。
 *     (同源教训见 `../capability/types.ts` 顶部:能靠类型挡住的,不要靠文档。)
 *
 *  3. **「是否支持凭据交换」只有一个事实源**:{@link IdentityProvider.exchange} 这个
 *     **可选方法是否存在**。不得另设 `supported: boolean` 标志位 —— 两个事实源必然会
 *     出现「声明 true 却没实现方法」的不一致,类型挡不住,只会在用户点「登录」时炸。
 *     HTTP 投影里给 UI 看的 `canExchange` 由路由层从方法存在性**派生**,同样不由实现声明。
 *
 * pi-SDK-free:只从纯类型文件取 `CapabilityTenant` 与 `HOST_CONTRACT_VERSION`,零运行期
 * 依赖,可安全经主 barrel 重导出。
 */
import type { HOST_CONTRACT_VERSION } from "@blksails/pi-web-core/host-contract-version.js";
import type { CapabilityTenant } from "@blksails/pi-web-core/capability/types.js";

/**
 * 当前身份状态。
 *
 * **判别联合**(不变式 2):`kind: "authenticated"` 必然携带 `tenant`,
 * 「已认证但没有身份」在类型上不可表达。
 */
export type IdentityState =
  | { readonly kind: "authenticated"; readonly tenant: CapabilityTenant }
  | { readonly kind: "anonymous" };

/**
 * 账号密码凭据。v1 只有这一种交换形态(实测确认云端只提供
 * `POST /api/desktop/login { email, password }`,无任何 device 授权端点)。
 *
 * `method` 判别符是为将来留的增量演进位:新增形态即加一个联合分支,不改既有签名。
 */
export interface IdentityPasswordCredentials {
  readonly method: "password";
  readonly email: string;
  readonly password: string;
}

/** 可用于交换身份的凭据。v1 = 账号密码。 */
export type IdentityCredentials = IdentityPasswordCredentials;

/**
 * 交换失败的类别。
 *
 * 分类是**契约的一部分**而非实现细节:它决定 HTTP 状态码与用户可读文案,
 * 也决定用户该「改账号密码重试」还是「原样重试」。四类不可合并 —— 合并任意两类
 * 都会产生「云端故障被当成密码错误」或反之的误判。
 */
export type IdentityExchangeFailure =
  /** 云端明确拒绝(401)。用户应更正账号或密码后重试。 */
  | "invalid-credentials"
  /**
   * 账号密码正确,但该账号**没有租户归属**(403)。
   *
   * ★ 与 `invalid-credentials` 分开是必需的:让这类用户去「更正密码」,他只会反复
   * 输入同一个正确的密码。他该做的是换账号,或找管理员开通归属。
   */
  | "no-membership"
  /** 入参不合法(邮箱或密码为空)。请求根本没有发出或被云端以 400 拒绝。 */
  | "invalid-request"
  /** 云端不可达、超时,或响应形状非预期。用户可原样重试。 */
  | "cloud-unreachable"
  /**
   * 凭据已从云端取得,但能力授予加载失败。
   *
   * ★ 此时**不得**进入已登录态(契约 §4.2「失败即拒绝」)。对用户表现为「登录未成功」,
   * 可重试;半登录态(有凭据无授予)会让后续每一处消费方各自撞上不同的空指针。
   */
  | "capabilities-failed";

/** 一次凭据交换的结果。失败**不抛**,全部经此表达(不变式 1)。 */
export type IdentityExchangeResult =
  | { readonly ok: true; readonly state: IdentityState }
  | { readonly ok: false; readonly reason: IdentityExchangeFailure };

/**
 * 宿主向 pi-web 提供「当前身份」的端口。
 *
 * 语义保证见本文件顶部三条不变式与契约 §6。
 */
export interface IdentityProvider {
  /** 实现所遵循的契约版本;类型层即钉死,宿主无法声明别的版本。 */
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;

  /**
   * 取当前身份。
   *
   * @returns 已具备身份 → `authenticated`;不具备 → `anonymous`。
   * @throws **不抛**。「拿不到身份」是正常态(不变式 1);实现内部的探测异常须自行
   *         吞掉并降级为 `anonymous`,否则宿主无法区分「未登录」与「探测失败」。
   */
  current(): Promise<IdentityState>;

  /**
   * 以凭据换取身份。
   *
   * **可选方法**:存在即代表该宿主支持凭据交换(不变式 3)。身份来自外部会话的宿主
   * (如云端多租户 web)**不应**实现它 —— 缺席是正常的,不是缺陷,宿主不得因此报错或告警。
   *
   * @returns 成功 → `{ok:true,state}`,此后 {@link current} 必须返回同一 `tenant`。
   *          失败 → `{ok:false,reason}`,此后 {@link current} 必须返回**调用前的状态**
   *          (不得半途改变身份)。
   * @throws **不抛**(不变式 1)。
   */
  exchange?(credentials: IdentityCredentials): Promise<IdentityExchangeResult>;

  /**
   * 放弃当前身份(登出)。
   *
   * **可选方法**:身份来自外部会话的宿主无从「放弃」它,缺席是正常的。
   *
   * 实现须一并清除因该身份取得的**授予缓存** —— 只清身份不清授予,下一个登录的用户
   * 会读到上一个用户的 token。
   */
  revoke?(): Promise<void>;
}

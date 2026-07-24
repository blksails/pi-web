/**
 * 能力授予端口 —— 类型契约(spec: host-contract-ports,任务 5.1;Req 5.1-5.7)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §4。本文件**只有类型**,无任何实现,
 * 使两端(pi-clouds 的云端授予 / 桌面的登录态授予)可先据此实现。内建实现
 * (`EnvCapabilityProvider` / `HttpCapabilityProvider`)属后续阶段,本期不交付。
 *
 * 三条不变式,是本端口存在的理由:
 *
 *  1. **「不可用」与「加载失败」必须可区分**(Req 5.1/5.2/5.5)。前者是正常态(未登录、
 *     云端未启用),以快照中该字段**缺失**表达,消费方据此退回本地形态;后者是异常
 *     (网络故障、凭据非法),以任一 `load*` 方法(`loadStatic` / `loadForSession`)**抛错**
 *     表达,宿主据此拒绝进入已登录态。
 *     二者混同的代价是具体的:都用错误表达,则「未登录」与「故障」不可分;都用缺失
 *     表达,则伪造凭据会被当成「未启用」而静默放行。
 *     ⚠ 抛错时**不得**返回部分快照(Req 5.5)——半个快照会让消费方一半降级一半不降级。
 *
 *  2. **附件授予必须带会话作用域**(Req 5.3/5.4),且这条由**方法签名机械强制**(契约勘误⑫a)。
 *     签发不含 sessionId 的公司级附件授权,等于让同一租户内任意用户读取彼此所有会话的附件,
 *     直接击穿既有隔离——这种约束不能只靠文档。故拆成两个方法:{@link CapabilityProvider.loadStatic}
 *     的返回类型是 {@link StaticCapabilitySnapshot},其中 `attachments` 被钉成 `never`,
 *     实现体一旦签发附件授予即**编译不过**。
 *     ⚠ **不要改回 `load(sessionId?: string)` 加重载**:重载形态挡不住。TS 不拿实现签名逐条
 *     校验每个重载,只做一次宽松兼容检查,故 `load(): Promise<S & { attachments?: never }>`
 *     配上实现体 `return { attachments }` 是**编译通过**的——它惩罚「没照格式写」的人,不惩罚
 *     「越权签发」的人,是虚假安全感。此结论由任务 5.1 复核者写探针实证,已入契约勘误⑫a。
 *
 *  3. **凭据禁落盘**(Req 5.6)。快照中的 token 是短期授予,禁止写入 Workspace、日志或
 *     任何持久介质;凭据只存 OS 钥匙串。故所有授予皆声明为只读投影(编译期挡住
 *     「就地改写当可变缓存」这一最常见的落盘前奏),并强制携带 {@link CapabilityGrantBase.expiresAt},
 *     使「按失效时刻续期」而非「存起来长期用」成为默认写法。
 *
 * pi-SDK-free:只从纯类型文件 `../auth/egress-model.js` 取 `EgressModel`。
 * ⚠ **不得**改从 `../auth/egress-model-source.js` 取 —— 该文件静态值导入 pi SDK
 * (`AuthStorage`/`ModelRegistry`),一旦引入即破坏主 barrel 的 pi-SDK-free 纪律,
 * 把整套 pi SDK 打进路由 bundle 并触发 `node:fs` 崩溃。
 */
import type { HOST_CONTRACT_VERSION } from "../host-contract-version.js";
import type { EgressModel } from "../auth/egress-model.js";

/**
 * 所有能力授予的共同基型:每项授予都带**可被调用方读取的失效时刻**(Req 5.7)。
 *
 * 契约不规定缓存策略(§4.2 第 5 条):实现可以每次真调,宿主按 `expiresAt` 自行缓存与续期。
 * 没有这个字段,调用方要么每次真调(浪费),要么无限期持有(过期后才在业务路径上炸)。
 */
export interface CapabilityGrantBase {
  /** 授予失效时刻,**epoch 秒**(非毫秒、非 ISO 字符串),便于与 `Date.now()/1000` 直接比较。 */
  readonly expiresAt: number;
}

/** 租户身份。三字段皆必填:身份是完整的或根本没有,半个身份无法用于鉴权。 */
export interface CapabilityTenant {
  readonly userId: string;
  readonly companyId: string;
  readonly role: string;
}

/**
 * LLM 出口授予(契约 §4.1 的 `egress`)。
 *
 * 结构等价于既有 `EgressModelSourceInput` 的**授予部分**:宿主给 `baseUrl` + `models`,
 * 会话局部信息(`agentDir` / `credential`)由调用方补齐。二者的结构兼容性由
 * `test/capability/types.test-d.ts` 在编译期钉住——形状一旦漂移,授予就喂不进既有出口。
 */
export interface CapabilityEgressGrant extends CapabilityGrantBase {
  /** OpenAI 兼容出口根(如 `https://egress.example/v1`)。 */
  readonly baseUrl: string;
  /** 该出口暴露的模型清单;为空表示无可用模型(消费方应视同该能力不可用)。 */
  readonly models: ReadonlyArray<EgressModel>;
}

/**
 * 「端点 + 短期 token」形态的授予,用于 agent source registry 访问与附件远端后端
 * (契约 §4.1 的 `sources` / `attachments`)。
 *
 * ⚠ `token` 是凭据:禁止写入 Workspace、日志或任何持久介质(Req 5.6)。
 */
export interface CapabilityTokenGrant extends CapabilityGrantBase {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * 一次能力加载的结果快照。
 *
 * **各字段独立可选**(Req 5.1):任一字段缺失即表示该项能力不可用,消费方**必须**降级到
 * 本地形态而非报错(Req 5.2)。字段之间**没有**蕴含关系——拿到 `tenant` 不代表拿到
 * `egress`,消费方须逐项判空。
 */
export interface CapabilitySnapshot {
  readonly tenant?: CapabilityTenant;
  readonly egress?: CapabilityEgressGrant;
  readonly sources?: CapabilityTokenGrant;
  /**
   * 附件远端后端授予。**只可能**出现在 {@link CapabilityProvider.loadForSession} 的返回里,
   * 且作用域限定于该会话(Req 5.3/5.4)。静态路径由 {@link StaticCapabilitySnapshot} 禁止它。
   */
  readonly attachments?: CapabilityTokenGrant;
}

/**
 * 静态能力快照:**不含**任何会话作用域授予(Req 5.3;契约 §4.1 勘误⑫a)。
 *
 * `attachments` 被钉成 `never` 而非简单省略——二者的差别正是这个类型存在的理由:
 * 省略只是「碰巧没给」,实现返回它照样编译通过;钉成 `never` 才是「禁止给」,
 * 越权签发在编译期即不成立。
 */
export type StaticCapabilitySnapshot = Omit<CapabilitySnapshot, "attachments"> & {
  readonly attachments?: never;
};

/**
 * 宿主向 pi-web 授予云端能力的端口。
 *
 * 语义保证见本文件顶部三条不变式与契约 §4.2。
 */
export interface CapabilityProvider {
  /** 实现所遵循的契约版本;类型层即钉死,宿主无法声明别的版本(Req 9.1)。 */
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;
  /**
   * 加载**静态**能力(tenant / egress / sources)。
   *
   * @returns 静态快照;任一能力不可用以对应字段缺失表达(Req 5.2)。
   *          **签发附件授予会编译不过**(Req 5.3),见 {@link StaticCapabilitySnapshot}。
   * @throws 整体加载失败时 reject,且**不返回部分快照**(Req 5.5)。宿主此时不得进入已登录态。
   */
  loadStatic(): Promise<StaticCapabilitySnapshot>;
  /**
   * 加载静态能力 + **该会话作用域**的能力(附件)。
   *
   * @param sessionId 会话标识,必填。附件授予的作用域限定于它(Req 5.4)。
   * @returns 能力快照;任一能力不可用以对应字段缺失表达(Req 5.2)。
   * @throws 整体加载失败时 reject,且**不返回部分快照**(Req 5.5)。
   */
  loadForSession(sessionId: string): Promise<CapabilitySnapshot>;
}

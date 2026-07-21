/**
 * 能力授予端口 —— 类型层契约断言(spec: host-contract-ports,任务 5.1;Req 5.1-5.7)。
 *
 * 本文件**没有运行期断言**,也不被 vitest 收集(`vitest.config.ts` 只收 `test/**\/*.test.ts`)。
 * 它由 `pnpm --filter @blksails/pi-web-server typecheck` 验收:每条断言的失败形态是**编译错误**。
 *
 * 两类断言各有其杀伤力,缺一不可:
 *  - 正向赋值:形状被改窄/字段被删/字段类型被改 → 赋值不成立,tsc 报错。
 *  - `@ts-expect-error`:契约要禁止的写法一旦变得**合法**,该指令即成为「未使用的
 *    ts-expect-error」,tsc 同样报错。这一方向是纯正向断言给不了的——把 `expiresAt`
 *    改成可选,只写正向断言的文件依然全绿。
 */
import type { EgressModel } from "../../src/auth/egress-model.js";
import type { EgressModelSourceInput } from "../../src/auth/egress-model-source.js";
import type {
  CapabilityEgressGrant,
  CapabilityGrantBase,
  CapabilityProvider,
  CapabilitySnapshot,
  CapabilityTenant,
  CapabilityTokenGrant,
  StaticCapabilitySnapshot,
} from "../../src/capability/index.js";

declare const egressGrant: CapabilityEgressGrant;
declare const tokenGrant: CapabilityTokenGrant;
declare const tenant: CapabilityTenant;
declare const snapshot: CapabilitySnapshot;
declare const provider: CapabilityProvider;

// ---------------------------------------------------------------------------
// 观察态:授予类型与**既有**出口输入形状可互换(Req 5.1;design「Validation」)
//
// 既有消费面是 `buildEgressModelSource(input: EgressModelSourceInput)` —— 今天由
// `resolveEgressModelSourceFromEnv` 从 env 拼出,将来由宿主经 CapabilityProvider 授予。
// 若两者形状对不上,两端各自实现出来的授予就喂不进 pi-web,而这一点在运行期才暴露。
// ---------------------------------------------------------------------------

/** 授予 + 会话局部信息(agentDir/credential)即可组成既有出口输入,models **无需转换**。 */
const egressInput: EgressModelSourceInput = {
  agentDir: "/tmp/agent",
  egressBaseUrl: egressGrant.baseUrl,
  credential: "desktop-credential",
  models: egressGrant.models,
};
void egressInput;

/** 反向:既有出口的模型清单可直接充当授予的模型清单(两侧元素类型互相可赋值)。 */
declare const hostModels: ReadonlyArray<EgressModel>;
const grantModels: CapabilityEgressGrant["models"] = hostModels;
void grantModels;

// ---------------------------------------------------------------------------
// Req 5.7:每项授予都带可被调用方读取的失效时刻
// ---------------------------------------------------------------------------

/** 两类授予都是授予基型 —— 调用方可不区分种类地做缓存/续期决策。 */
const egressAsBase: CapabilityGrantBase = egressGrant;
const tokenAsBase: CapabilityGrantBase = tokenGrant;
void egressAsBase;
void tokenAsBase;

/** `expiresAt` 是 epoch 秒,可直接参与数值比较(而非 Date/字符串)。 */
const stillValid: boolean = egressGrant.expiresAt > Date.now() / 1000;
void stillValid;

// @ts-expect-error Req 5.7:egress 授予缺 expiresAt 不成立
const egressWithoutExpiry: CapabilityEgressGrant = {
  baseUrl: "https://egress.example/v1",
  models: [],
};
void egressWithoutExpiry;

// @ts-expect-error Req 5.7:token 授予缺 expiresAt 不成立
const tokenWithoutExpiry: CapabilityTokenGrant = {
  baseUrl: "https://sources.example",
  token: "t",
};
void tokenWithoutExpiry;

// ---------------------------------------------------------------------------
// Req 5.1/5.2:快照各字段独立可选,不可用以「缺失」表达
// ---------------------------------------------------------------------------

/** 全部能力都不可用 —— 这是合法快照(未登录/云端未启用的正常态),不是错误。 */
const nothingAvailable: CapabilitySnapshot = {};
void nothingAvailable;

/** 每一项都能**单独**出现:宿主只授予其中一项时快照依然成立。 */
const onlyTenant: CapabilitySnapshot = { tenant };
const onlyEgress: CapabilitySnapshot = { egress: egressGrant };
const onlySources: CapabilitySnapshot = { sources: tokenGrant };
const onlyAttachments: CapabilitySnapshot = { attachments: tokenGrant };
void onlyTenant;
void onlyEgress;
void onlySources;
void onlyAttachments;

if (snapshot.tenant !== undefined) {
  // @ts-expect-error Req 5.1:拿到 tenant 不蕴含拿到 egress,消费方必须逐项判空后降级
  void snapshot.egress.baseUrl;
}

if (snapshot.egress !== undefined) {
  // @ts-expect-error Req 5.1:拿到 egress 同样不蕴含拿到 attachments
  void snapshot.attachments.token;
  // 逐项判空后方可取用。
  const baseUrl: string = snapshot.egress.baseUrl;
  void baseUrl;
}

// ---------------------------------------------------------------------------
// Req 5.3/5.4:两段式 —— 附件授予仅在带会话标识请求时出现(契约 §4.1 勘误⑫a)
//
// ⚠ 这一节的两条负向断言是本文件里唯一守**安全边界**的断言(越权签发公司级附件授权 =
// 同租户用户互读会话附件)。它们必须挡住**实现体**,而不只是挡住调用方——重载形态就是
// 栽在这里:TS 只对实现签名做一次宽松兼容检查,实现体越权签发照样编译通过。
// ---------------------------------------------------------------------------

/** 调用面:静态路径无参,会话路径的 sessionId 必填。 */
const staticLoad: Promise<StaticCapabilitySnapshot> = provider.loadStatic();
const scopedLoad: Promise<CapabilitySnapshot> = provider.loadForSession("session-1");
void staticLoad;
void scopedLoad;

// @ts-expect-error Req 5.4:会话标识必填 —— 缺了它就没有作用域可言
void provider.loadForSession();

/** 消费面:静态快照里的 attachments 只能是 undefined,取它没有意义(而非「可能有」)。 */
declare const staticSnapshot: StaticCapabilitySnapshot;
const noAttachments: undefined = staticSnapshot.attachments;
void noAttachments;

/** ★ 实现面(a):`loadStatic` 直接返回带附件授予的字面量 —— 越权签发,编译不过。 */
const leakingLiteralProvider: CapabilityProvider = {
  contractVersion: 1,
  // @ts-expect-error Req 5.3:静态路径禁止签发附件授予(字面量直返)
  loadStatic: async () => ({ tenant, attachments: tokenGrant }),
  loadForSession: async () => ({ attachments: tokenGrant }),
};
void leakingLiteralProvider;

/**
 * ★ 实现面(b):经中间变量返回(绕开对象字面量的 excess property check)—— 同样编译不过。
 *
 * ⚠ 二者的分工被**两轮**实证依次修正,结论比直觉绕,故写全:
 *  - 本文件初稿注为「(a) 靠 excess property check、(b) 靠 `never` 补 EPC 被中间变量绕过的漏」。
 *    把 {@link StaticCapabilitySnapshot} 变异成不带 `attachments?: never` 的裸 `Omit` 后,
 *    (a) 与 (b) **同时**变绿 —— (a) 的保护并非来自 EPC,该说法证伪。
 *  - 但据此推广出的「EPC 在经 `Promise<T>` 包装处不触发」**同样是错的**(任务 5.1 复核者隔离
 *    探针证伪:`async function f(): Promise<T> { return {…越权…} }` 照样报 `TS2353`)。
 *    真正的分界是**返回类型的来源**:显式注解 → EPC 触发;由上下文推断 → 不触发。
 *    本文件的 `loadStatic: async () => ({…})` 属后者,故那里 EPC 缺席。
 *
 * 于是 (b) 的价值反而更强:`attachments?: never` 在四种写法下**全挡**,EPC 只覆盖其中
 * 「显式注解」那一半 —— (b) 覆盖的正是 EPC **够不到**的另一半(两端实现者若写成
 * `const p: CapabilityProvider = { loadStatic: async () => {…} }` 就落在这一半里)。
 * 真正的绕过路径只剩显式 `as any` —— grep/lint 可见。
 */
const leakingViaVariableProvider: CapabilityProvider = {
  contractVersion: 1,
  // @ts-expect-error Req 5.3:经中间变量绕过 excess property check 同样不成立
  loadStatic: async () => {
    const withAttachments: CapabilitySnapshot = { attachments: tokenGrant };
    return withAttachments;
  },
  loadForSession: async () => ({ attachments: tokenGrant }),
};
void leakingViaVariableProvider;

// ---------------------------------------------------------------------------
// Req 9.1:契约版本由 pi-web 钉死,宿主不得自行声明别的版本
// ---------------------------------------------------------------------------

const conformingProvider: CapabilityProvider = {
  contractVersion: 1,
  loadStatic: async () => ({}),
  loadForSession: async () => ({}),
};
void conformingProvider;

const wrongVersionProvider: CapabilityProvider = {
  // @ts-expect-error 契约版本是单一事实源,声明成别的版本在编译期即不成立
  contractVersion: 2,
  loadStatic: async () => ({}),
  loadForSession: async () => ({}),
};
void wrongVersionProvider;

// ---------------------------------------------------------------------------
// 租户身份三字段皆必填(契约 §4.1);快照与授予是**只读投影**
// ---------------------------------------------------------------------------

// @ts-expect-error 契约 §4.1:tenant 的 userId/companyId/role 皆必填
const partialTenant: CapabilityTenant = { userId: "u", companyId: "c" };
void partialTenant;

// @ts-expect-error Req 5.6:授予是短期只读投影,不得被就地改写当作可变缓存
tokenGrant.token = "rotated";

// @ts-expect-error Req 5.6:快照同样只读,消费方不得就地塞入/抹除能力项
snapshot.attachments = tokenGrant;

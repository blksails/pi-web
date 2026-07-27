/**
 * 身份获取端口 P5 —— 类型层契约断言(spec: desktop-account-login,任务 1.2;Req 1.2/1.4)。
 *
 * 本文件**没有运行期断言**,不被 vitest 收集;由
 * `pnpm --filter @blksails/pi-web-server typecheck` 验收 —— 每条断言的失败形态是编译错误。
 *
 * 与 `../capability/types.test-d.ts` 同样两类断言并用:正向赋值挡「形状被改窄」,
 * `@ts-expect-error` 挡「本该禁止的写法变得合法」。后者是纯正向断言给不了的方向——
 * 把 `tenant` 从必填改成可选,只写正向断言的文件依然全绿。
 */
import type { CapabilityTenant } from "../../src/capability/index.js";
import type {
  IdentityCredentials,
  IdentityExchangeFailure,
  IdentityExchangeResult,
  IdentityProvider,
  IdentityState,
} from "../../src/identity/types.js";

declare const tenant: CapabilityTenant;

// ---------------------------------------------------------------------------
// 不变式 2:身份是完整的或根本没有(Req 5.1)
//
// 判别联合的全部价值在于「已认证但没有身份」不可表达。若哪天有人把它改成
// `{ kind: "authenticated"; tenant?: CapabilityTenant }`,下面第一条 ts-expect-error
// 会变成「未使用」,tsc 立刻报错。
// ---------------------------------------------------------------------------

const authenticated: IdentityState = { kind: "authenticated", tenant };
const anonymous: IdentityState = { kind: "anonymous" };
void authenticated;
void anonymous;

// @ts-expect-error authenticated 必须携带 tenant —— 半个身份无法用于鉴权
const missingTenant: IdentityState = { kind: "authenticated" };
void missingTenant;

// @ts-expect-error anonymous 不得携带 tenant —— 否则「无身份」这个状态就失去含义
const anonymousWithTenant: IdentityState = { kind: "anonymous", tenant };
void anonymousWithTenant;

// @ts-expect-error kind 是封闭判别符,不接受任意字符串
const unknownKind: IdentityState = { kind: "half-logged-in" };
void unknownKind;

// ---------------------------------------------------------------------------
// 不变式 3:「不支持交换」由方法缺席表达(Req 1.4)
//
// 这条断言是 Req 1.4 的类型证明:一个只实现 current() 的宿主必须能合法赋值给
// IdentityProvider。若哪天有人把 exchange 改成必填,这行即编译不过——而那正是
// 「云端多租户被迫做假登录交互」这个设计错误的入口。
// ---------------------------------------------------------------------------

const currentOnly: IdentityProvider = {
  contractVersion: 1,
  current: async () => ({ kind: "anonymous" }),
};
void currentOnly;

const fullProvider: IdentityProvider = {
  contractVersion: 1,
  current: async () => ({ kind: "authenticated", tenant }),
  exchange: async () => ({ ok: true, state: { kind: "authenticated", tenant } }),
  revoke: async () => {},
};
void fullProvider;

const wrongVersion: IdentityProvider = {
  // @ts-expect-error contractVersion 在类型层即钉死,宿主无法声明别的版本
  contractVersion: 2,
  current: async () => ({ kind: "anonymous" }),
};
void wrongVersion;

// ---------------------------------------------------------------------------
// 不变式 1:失败经返回值表达,且失败类别是封闭集合
// ---------------------------------------------------------------------------

const failures: readonly IdentityExchangeFailure[] = [
  "invalid-credentials",
  "invalid-request",
  "cloud-unreachable",
  "capabilities-failed",
];
void failures;

// @ts-expect-error 失败类别是封闭联合;新增类别须同步改路由的 HTTP 映射,故不许临时造词
const adHocFailure: IdentityExchangeFailure = "something-went-wrong";
void adHocFailure;

const okWithReason: IdentityExchangeResult = {
  ok: true,
  state: { kind: "anonymous" },
  // @ts-expect-error ok:true 分支不得携带 reason —— 成功与失败的字段集互斥
  reason: "cloud-unreachable",
};
void okWithReason;

// ---------------------------------------------------------------------------
// 凭据形态:v1 只有账号密码,且 method 判别符必填(为增量演进留位)
// ---------------------------------------------------------------------------

const passwordCredentials: IdentityCredentials = {
  method: "password",
  email: "a@example.com",
  password: "secret",
};
void passwordCredentials;

// @ts-expect-error 缺 method 判别符 —— 将来新增交换形态时,无判别符的入参无法分派
const noMethod: IdentityCredentials = { email: "a@example.com", password: "secret" };
void noMethod;

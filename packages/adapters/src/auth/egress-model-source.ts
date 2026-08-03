/**
 * desktop-cloud-login · 会话模型来源(登录态经 egress 出口,design.md §Components/egress-model-source,
 * Req 3.1/3.2/3.3/4.1/4.3/5.1/5.2/7.2)。
 *
 * 纯工厂:给定「本次会话是否登录 + egress 配置」,产出注入 pi SDK `createAgentSessionServices`
 * 的 `{ authStorage, modelRegistry }`。
 *
 * - 登录态:复用共享 `<agentDir>/auth.json`(`AuthStorage.create`)+ `ModelRegistry.create` 叠加
 *   `registerProvider("pi-cloud", { baseUrl:<egress>, apiKey:<桌面凭据>, authHeader:true, models })`。
 *   **只读本地 `<agentDir>/models.json`、绝不写入**:磁盘上既有的自定义 provider 与覆写照常生效
 *   (spec multi-gateway-providers 任务 2.1,Req 6.1/6.3/6.4),仍不改 agentDir、不新增文件
 *   (守 Req 5.3/5.5);sk-gw 云端换取(B-pure),本仓 registry 只持桌面凭据、绝不含 sk-gw(Req 3.3/5.1)。
 * - 未登录/未启用:返回 `undefined` → 调用方保持 SDK 默认(共享 auth.json + models.json)。
 *
 * ⚠ provider 名固定 `pi-cloud` 命名空间:不得与 `auth.json` 已有 provider 撞名,否则 auth.json 的
 * key 覆盖本 provider 的 apiKey(pi SDK `getApiKeyAndHeaders` 顺序)。
 */
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { EgressModel } from "@blksails/pi-web-core/capability/egress-model.js";

export type { EgressModel };

/** egress provider 命名空间(会话 model 引用形如 `pi-cloud/<id>`)。 */
// 同 AI_GATEWAY_PROVIDER_NAME:常量下沉到中立模块,此处原样 re-export。
import { EGRESS_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
export { EGRESS_PROVIDER_NAME };

/** `buildEgressModelSource` 的输入。 */
export interface EgressModelSourceInput {
  /** 会话 agentDir(auth 复用 `<agentDir>/auth.json`)。 */
  readonly agentDir: string;
  /** egress base(OpenAI 兼容根,如 `https://egress/v1`);缺省=未启用。 */
  readonly egressBaseUrl?: string;
  /** 当前有效桌面凭据明文;缺省=未登录。 */
  readonly credential?: string;
  /** egress 暴露的模型清单;为空=不注入(无可用模型无意义)。 */
  readonly models: ReadonlyArray<EgressModel>;
}

/** 注入 `createAgentSessionServices` 的项。 */
export interface InjectedModelServices {
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
}

/** egress 为 OpenAI 兼容出口,provider/model 的 api 固定 openai-completions。 */
const EGRESS_API = "openai-completions";

function toProviderModel(m: EgressModel): {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
} {
  return {
    id: m.id,
    name: m.name ?? m.id,
    api: EGRESS_API,
    reasoning: m.reasoning ?? false,
    input: [...(m.input ?? ["text"])],
    // 计费在云端网关权威;本地 registry 成本仅占位(不用于扣费)。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128_000,
    maxTokens: m.maxTokens ?? 8_192,
  };
}

/**
 * 解析所得的 egress 来源(不含 agentDir —— registry 的构造已上移到调用方)。
 *
 * spec ai-gateway-session-models 任务 1.2:拆出「解析」与「注册」两层,使 egress 与
 * ai-gateway 两个来源能注册进**同一个** registry。`servicesOptions.modelRegistry` 只有
 * 一个位置,谁自建 registry 谁就会顶掉对方。
 */
export interface EgressSpec {
  readonly egressBaseUrl: string;
  readonly credential: string;
  readonly models: ReadonlyArray<EgressModel>;
}

/**
 * 纯解析:判定 egress 来源是否具备条件。
 *
 * @returns 三要素齐全 → spec;任一缺失(未启用/未登录/无模型)→ `undefined`。
 */
export function resolveEgressSpec(input: {
  readonly egressBaseUrl?: string;
  readonly credential?: string;
  readonly models: ReadonlyArray<EgressModel>;
}): EgressSpec | undefined {
  const base = input.egressBaseUrl?.trim();
  const credential = input.credential?.trim();
  if (base === undefined || base.length === 0) return undefined;
  if (credential === undefined || credential.length === 0) return undefined;
  if (input.models.length === 0) return undefined;
  return { egressBaseUrl: base, credential, models: input.models };
}

/** 从 runner 自身 env 解析 egress 来源(不构造 registry)。 */
export function resolveEgressSpecFromEnv(
  env: NodeJS.ProcessEnv,
): EgressSpec | undefined {
  const egressBaseUrl = env.PI_WEB_CLOUD_EGRESS_BASE;
  const credential = env.PI_WEB_DESKTOP_CREDENTIAL;
  const rawModels = env.PI_WEB_CLOUD_EGRESS_MODELS;
  if (
    egressBaseUrl === undefined ||
    credential === undefined ||
    rawModels === undefined
  ) {
    return undefined;
  }
  let models: ReadonlyArray<EgressModel>;
  try {
    const parsed: unknown = JSON.parse(rawModels);
    models = Array.isArray(parsed) ? (parsed as ReadonlyArray<EgressModel>) : [];
  } catch {
    return undefined;
  }
  return resolveEgressSpec({ egressBaseUrl, credential, models });
}

/** 把 egress 来源注册进给定 registry(只注册,不自建 —— 见 {@link EgressSpec})。 */
export function registerEgressProvider(
  registry: ModelRegistry,
  spec: EgressSpec,
): void {
  registry.registerProvider(EGRESS_PROVIDER_NAME, {
    baseUrl: spec.egressBaseUrl,
    apiKey: spec.credential,
    api: EGRESS_API,
    // authHeader:true → pi SDK 出 `Authorization: Bearer <credential>`,egress 据此验签换 sk-gw。
    authHeader: true,
    models: spec.models.map(toProviderModel),
  });
}

/**
 * 构造共享 auth.json + `<agentDir>/models.json` 之上的 registry(两个来源共用,见 {@link EgressSpec})。
 *
 * spec multi-gateway-providers 任务 2.1 缺陷修复:此前用 `ModelRegistry.inMemory` 起一个空
 * registry,任何模型源一启用就会**替换**掉本地磁盘配置 —— 使用者在 `models.json` 里的自定义
 * provider、内置 provider 覆写、以及以此形式提供的凭据全部消失(Req 6.1/6.3)。
 * 改用 `ModelRegistry.create` 先加载磁盘配置,egress/ai-gateway 两个来源随后在其上**叠加**
 * `registerProvider`(Req 6.4)—— 只读不写,不改变「不落盘」的既有约束。
 */
export function createSharedModelServices(agentDir: string): InjectedModelServices {
  // 复用共享 auth.json(与 SDK 默认同源),不改 agentDir。
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  return { authStorage, modelRegistry };
}

/**
 * 依登录态构造注入项。
 *
 * @returns 登录且启用且有模型 → `{ authStorage, modelRegistry }`;否则 `undefined`。
 */
export function buildEgressModelSource(
  input: EgressModelSourceInput,
): InjectedModelServices | undefined {
  const spec = resolveEgressSpec(input);
  if (spec === undefined) return undefined;
  const services = createSharedModelServices(input.agentDir);
  registerEgressProvider(services.modelRegistry, spec);
  return services;
}

/**
 * runner 侧从自身 env 解析并构造注入项(装配层 computeAuthEgressSpawnEnv 下发的三件套)。
 *
 * 读 `PI_WEB_CLOUD_EGRESS_BASE` / `PI_WEB_DESKTOP_CREDENTIAL` / `PI_WEB_CLOUD_EGRESS_MODELS`;
 * 任一缺失或模型 JSON 非法 → 返回 `undefined`(runner 走 SDK 默认,不因登录配置异常打断本地路径)。
 *
 * @param agentDir 会话 agentDir(auth 复用 `<agentDir>/auth.json`)。
 * @param env 环境变量来源(runner 传 `process.env`)。
 */
export function resolveEgressModelSourceFromEnv(
  agentDir: string,
  env: NodeJS.ProcessEnv,
): InjectedModelServices | undefined {
  const spec = resolveEgressSpecFromEnv(env);
  if (spec === undefined) return undefined;
  const services = createSharedModelServices(agentDir);
  registerEgressProvider(services.modelRegistry, spec);
  return services;
}

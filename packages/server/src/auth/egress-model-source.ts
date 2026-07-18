/**
 * desktop-cloud-login · 会话模型来源(登录态经 egress 出口,design.md §Components/egress-model-source,
 * Req 3.1/3.2/3.3/4.1/4.3/5.1/5.2/7.2)。
 *
 * 纯工厂:给定「本次会话是否登录 + egress 配置」,产出注入 pi SDK `createAgentSessionServices`
 * 的 `{ authStorage, modelRegistry }`。
 *
 * - 登录态:复用共享 `<agentDir>/auth.json`(`AuthStorage.create`)+ `ModelRegistry.inMemory`
 *   + `registerProvider("pi-cloud", { baseUrl:<egress>, apiKey:<桌面凭据>, authHeader:true, models })`。
 *   **纯内存零落盘**:不写 `~/.pi/agent/models.json`、不改 agentDir(守 Req 5.3/5.5);sk-gw 云端换取
 *   (B-pure),本仓 registry 只持桌面凭据、绝不含 sk-gw(Req 3.3/5.1)。
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
import type { EgressModel } from "./egress-model.js";

export type { EgressModel };

/** egress provider 命名空间(会话 model 引用形如 `pi-cloud/<id>`)。 */
export const EGRESS_PROVIDER_NAME = "pi-cloud";

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
 * 依登录态构造注入项。
 *
 * @returns 登录且启用且有模型 → `{ authStorage, modelRegistry }`;否则 `undefined`。
 */
export function buildEgressModelSource(
  input: EgressModelSourceInput,
): InjectedModelServices | undefined {
  const base = input.egressBaseUrl?.trim();
  const credential = input.credential?.trim();
  if (base === undefined || base.length === 0) return undefined;
  if (credential === undefined || credential.length === 0) return undefined;
  if (input.models.length === 0) return undefined;

  // 复用共享 auth.json(与 SDK 默认同源),不改 agentDir。
  const authStorage = AuthStorage.create(path.join(input.agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(EGRESS_PROVIDER_NAME, {
    baseUrl: base,
    apiKey: credential,
    api: EGRESS_API,
    // authHeader:true → pi SDK 出 `Authorization: Bearer <credential>`,egress 据此验签换 sk-gw。
    authHeader: true,
    models: input.models.map(toProviderModel),
  });
  return { authStorage, modelRegistry };
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
  return buildEgressModelSource({ agentDir, egressBaseUrl, credential, models });
}

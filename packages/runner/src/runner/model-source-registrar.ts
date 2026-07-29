/**
 * 模型源注册契约与注册表(spec: kernel-boundary-decoupling,任务 4.1)。
 *
 * **问题**:runner 装配期要把「egress」与「ai-gateway」两个 provider 注册进共享
 * `ModelRegistry`。改造前 `option-mapper.ts` 直接 import 这两个具体实现,于是
 * `runner → auth` 与 `runner → ai-gateway` 两条跨层边成立 —— 切包后 runner 包会拖上
 * adapters 包。
 *
 * **解法**:依赖倒置。契约由 runner 层定义,具体实现住在 adapters 层并**自注册**进本表;
 * runner 只读表,不认识任何具体 provider。
 *
 * ★ **注入点为什么在引导脚本而不是 option-mapper**:若只让 option-mapper 接参数、
 *   而由 `runner.ts` 去 import 那两个模块,边只是从一个文件挪到另一个文件,跨层依赖依然成立。
 *   真正的解耦要求 **runner 子树完全不提及**这两个实现。故由 `runner-bootstrap.mjs`
 *   (在 `src/` 之外,是装配缝)先导入 `host-assembly/model-sources.ts`(assembly 层,
 *   按定义就允许引用 adapters),后者把实现登记进本表,runner 随后只消费表。
 *
 * ★ **为什么是模块级可变表而非参数穿透**:参数穿透要改 4 层签名
 *   (bootstrap → main → agent-loader → buildRuntimeFactory),而每一层都与本关注点无关。
 *   自注册表是插件模式的标准形态,且作用域限于单个 runner 子进程。
 */
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * 注册期可用的日志面。
 * ★ 刻意取**结构化 logger 的最小子集**(`info`),而非 `(msg: string) => void`:
 *   实际两侧传的都是结构化 logger(runner 的 `createLogger` 产物、ai-gateway 的
 *   `AiGatewaySessionLogger`),把契约拍成裸函数会两边都对不上(实测 TS2345 两处)。
 */
export interface ModelSourceLogger {
  info(msg: string, data?: Record<string, unknown>): void;
}

/** 共享的模型服务(单一 registry + 其 auth 存储)。 */
export interface SharedModelServices {
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
}

/**
 * 一个模型源的注册器。
 *
 * `TSpec` 是该源自己的配置形状 —— runner 不解释它,只负责「解析到了就注册」。
 */
export interface ModelSourceRegistrar<TSpec = unknown> {
  /**
   * provider 命名空间。
   * ★ 必须与该源注册进 registry 的名字**逐字一致** —— 前端选中的条目要靠它在 registry 里查到,
   *   两处漂移的表现是「列表里看得到、选中却说模型未找到」。
   */
  readonly providerName: string;
  /** 从环境解析该源的配置;未配置返回 `undefined`(不抛)。须无副作用。 */
  resolveSpecFromEnv(env: NodeJS.ProcessEnv): TSpec | undefined;
  /** 把该源注册进共享 registry。仅在 `resolveSpecFromEnv` 返回非空时被调用。 */
  register(registry: ModelRegistry, spec: TSpec, log: ModelSourceLogger): void;
}

const registrars: ModelSourceRegistrar[] = [];
let sharedServicesFactory: ((agentDir: string) => SharedModelServices) | undefined;

/** 登记一个模型源。由 assembly 层在 runner 启动前调用。重复登记同名 provider 会覆盖。 */
export function registerModelSource<TSpec>(registrar: ModelSourceRegistrar<TSpec>): void {
  const at = registrars.findIndex((r) => r.providerName === registrar.providerName);
  if (at >= 0) registrars[at] = registrar as ModelSourceRegistrar;
  else registrars.push(registrar as ModelSourceRegistrar);
}

/**
 * 登记共享模型服务的构造器。
 * 单独于 registrars 之外,因为它是**所有源共用的那一个 registry** 的来源 ——
 * 谁自建 registry 谁就顶掉别人,故必须只有一份。
 */
export function setSharedModelServicesFactory(
  factory: (agentDir: string) => SharedModelServices,
): void {
  sharedServicesFactory = factory;
}

/** 已登记的模型源(只读快照)。 */
export function listModelSources(): readonly ModelSourceRegistrar[] {
  return [...registrars];
}

/** 已登记的共享服务构造器;未登记时返回 `undefined`。 */
export function getSharedModelServicesFactory():
  | ((agentDir: string) => SharedModelServices)
  | undefined {
  return sharedServicesFactory;
}

/** 仅供测试:清空登记,使用例之间互不污染。 */
export function resetModelSourcesForTest(): void {
  registrars.length = 0;
  sharedServicesFactory = undefined;
}

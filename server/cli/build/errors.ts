/**
 * errors — `pi-web build` 的统一错误判别联合与阶段划分(spec cli-agent-build,
 * 任务 3.1,Req 1.3, 4.1, 5.1, 7.1;design.md「Error Strategy」)。
 *
 * 与 `server/cli/publish/manifest-compiler.ts` 的 `CompileError` + `describeCompileError`
 * 同一范式:一个覆盖全部构建阶段的判别联合 + 一个只翻译、不重新判断的呈现函数。
 * 后续各阶段(toolchain/pane-discovery/pane-build/panes-manifest/isolated-entry/runBuild)
 * 均以 `new BuildError({ stage, code, detail, path? })` 的形态抛出,不各自定义错误形状——
 * 这样 `runBuild`(任务 3.8)可以用同一个 `catch (e) { if (e instanceof BuildError) ... }`
 * 收敛全部阶段的失败路径,经 `ProgressReporter.fail()` 呈现(design.md「Monitoring」)。
 */

/** 构建的阶段划分,与 design.md「Architecture / System Flows」的流程步一一对应。 */
export type BuildStage =
  | "resolve" // agent source 定位 / webext 源探测(本任务,7.1)
  | "toolchain" // 工具链与样式预设解析(任务 3.2,4.2/4.4)
  | "discover" // pane 声明约定发现与求值(任务 3.3,3.1–3.4)
  | "pane" // pane 双形态产物生成(任务 3.5,2.2/4.3)
  | "webext" // webext 入口/样式/manifest 打包(任务 3.8,2.1/2.7)
  | "isolated" // 隔离入口与分派入口(任务 3.7,2.4/2.5)
  | "manifest"; // pane 静态清单组装与形态校验(任务 3.6,2.3/3.5)

/** 构造 `BuildError` 所需的字段(纯数据,供各阶段各自组装)。 */
export interface BuildErrorInput {
  /** 出错所在的构建阶段。 */
  readonly stage: BuildStage;
  /** 机读错误码,约定 `BUILD_<STAGE>_<REASON>` 形态,便于测试按码断言而不依赖文案措辞。 */
  readonly code: string;
  /** 面向用户的可操作文案——说「怎么改对」,不止说「哪里错了」(沿用 `describeCompileError` 范式)。 */
  readonly detail: string;
  /** 出问题的具体文件或目录路径(3.4「指出不合法的声明位置」、7.1「说明期望的源位置」)。 */
  readonly path?: string;
}

/**
 * 构建期错误。是一个真实 `Error` 子类(可 `throw`/`instanceof` 判别),同时携带
 * `BuildErrorInput` 的全部结构化字段,供 `runBuild` 翻译为 `CliError`(`{code, message}`)
 * 喂给 `reporter.fail()`。
 */
export class BuildError extends Error implements BuildErrorInput {
  override readonly name = "BuildError";
  readonly stage: BuildStage;
  readonly code: string;
  readonly detail: string;
  readonly path?: string;

  constructor(input: BuildErrorInput) {
    super(input.detail);
    this.stage = input.stage;
    this.code = input.code;
    this.detail = input.detail;
    if (input.path !== undefined) this.path = input.path;
  }
}

/**
 * 把 `BuildError` 翻译成一行可读文案(供 `reporter.fail()` 的 `message` 字段)。
 *
 * 与 `describeCompileError` 的关键差异:那里判别联合按具体 `code` 精细区分措辞
 * (各 case 各写一段指引),而这里每条 `BuildErrorInput.detail` 在**抛出点**已经是完整的
 * 可操作文案(抛出点掌握该阶段的具体上下文,如「期望的两种源目录约定」),`describeBuildError`
 * 只负责把 `detail` 与 `path`(若有)拼成最终呈现行,不重新判断措辞——避免第二处维护同一份文案。
 */
export function describeBuildError(error: BuildError): string {
  return error.path !== undefined ? `${error.detail}\n  位置:${error.path}` : error.detail;
}

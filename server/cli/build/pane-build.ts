/**
 * pane-build — pane 双形态产物生成(spec cli-agent-build,任务 3.5,Req 2.2, 4.3;
 * design.md「Components and Interfaces」`pane-build` 行、Requirements Traceability 2.2/4.3、
 * 「System Flows」流程步 6-7)。
 *
 * `pi-web build` 的第四阶段:把 `pane-discovery`(任务 3.3)求出的 {@link PaneModule} 集合
 * 逐个打包,为每个 pane 产出:
 *
 *  - **可独立寻址的双文件**(URL 形态,2.2):`pane-<id>.js`(脚本)+ `pane-<id>.html`
 *    (`<script src>` 引用该脚本的文档),写入 `outDir`——即将被
 *    `PaneDocument = { kind: "html", src }` 消费的静态资产。
 *  - **内联文档**(2.2):同一份脚本字节改以 `<script>` 内联,拼成一份完整 HTML 字符串,
 *    以 `paneId → html` 的映射**返回**、不落盘——`panes.json` sidecar(任务 3.6,
 *    `panes-manifest.ts` 头注已言明)刻意不携带 `document` 字段,内联文档由后续阶段(合成
 *    webext 运行期注册,任务 3.8 的职责)按需消费,不是本模块要落地的文件。
 *
 * 两种形态共用**同一次** `bundlePaneEntry` 产出的脚本字节(`packages/web-kit/build/
 * pane-document.ts` 头注「双形态」一节),本模块只做一次打包、两种渲染。
 *
 * ## 单例插件必须注入到每个 pane(4.3)
 *
 * pane 走 IIFE 打包,agent source 与 pi-web 宿主可能各自装了一份 react/react-dom
 * (`react-singleton.ts` 头注)。本模块对每次 `bundlePaneEntry` 调用都注入
 * `createReactSingletonPlugin(sourceRoot)`,解析基准固定为 **agent source 根**(与
 * 打包这个 pane 的入口物理上位于 source 内部还是被跨目录复用的兄弟 source 无关——
 * `sourceRoot` 由调用方传入,不是从 `entry` 反推)。
 *
 * ## 样式来自 2.3 的一次性解析结果,不在此处重跑
 *
 * `canvasCss` 由调用方经 `resolveCanvasCss()`(`packages/canvas-ui/build/pane-document.ts`,
 * 任务 2.3)预先算好、对同一次构建的全部画布 pane 只算一次后传入——本模块只按每个 pane 的
 * `canvasStyles` 声明**选择**是否叠加,不重新计算样式管线(避免重蹈「每个 pane 各自重跑一遍
 * 完整样式管线」的旧实现)。非画布 pane 只用通用层的 {@link PANE_BASE_CSS}。
 *
 * `canvasStyles: true` 但调用方未提供 `canvasCss`(如 agent source 一个画布 pane 都没声明,
 * 调用方因此跳过了 `resolveCanvasCss()`,却又在某个 pane 上误标了 `canvasStyles: true`)
 * 视为声明与调用方装配之间的不一致,以 `BuildError` 终止,不静默退化成无样式产物——
 * 静默退化正是本 spec 要根治的那类「结构漂移到运行期才炸」。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bundlePaneEntry,
  PANE_BASE_CSS,
  renderPaneDocument,
  renderPaneUrlDocument,
  type PaneBundleOptions,
} from "@blksails/pi-web-kit/build/pane-document";
import { BuildError } from "./errors.js";
import { createReactSingletonPlugin } from "./react-singleton.js";
import type { PaneModule } from "./pane-discovery.js";

/** `buildPaneArtifacts` 的装配参数。 */
export interface PaneBuildOptions {
  /** react-singleton 解析基准(agent source 根,4.3)——与 `entry` 物理位置无关。 */
  readonly sourceRoot: string;
  /** 双形态可寻址文件的写入目录(通常是 `resolveAgentSource().outDir`)。 */
  readonly outDir: string;
  /**
   * 2.3 一次性解析的画布样式;`canvasStyles: true` 的 pane 消费。全部 pane 都非画布时
   * 可省略。
   */
  readonly canvasCss?: string;
}

/** 单个 pane 写出的一对可寻址文件(URL 形态)。 */
export interface PaneBuildArtifact {
  readonly id: string;
  /** 写出的 `pane-<id>.js` 绝对路径。 */
  readonly scriptPath: string;
  /** 写出的 `pane-<id>.html` 绝对路径,`<script src>` 引用 `scriptPath` 的基名。 */
  readonly documentPath: string;
}

/** `buildPaneArtifacts` 的产出。 */
export interface PaneBuildResult {
  /**
   * 全部写出的可寻址文件,按 `modules` 输入顺序排列(每个 pane 先脚本后文档,2 × N 项)。
   * 顺序稳定、内容确定性打包(esbuild 生产模式无时间戳等易变输出),故对相同输入两次调用
   * 产出逐字节一致。
   */
  readonly files: readonly string[];
  /** 逐 pane 的写出路径明细,便于调用方(如 3.8 编排层)按 id 索引。 */
  readonly artifacts: readonly PaneBuildArtifact[];
  /** paneId → 内联文档 HTML;不落盘,供后续阶段消费(见文件头注释)。 */
  readonly documents: Readonly<Record<string, string>>;
}

function paneScriptFilename(id: string): string {
  return `pane-${id}.js`;
}

function paneDocumentFilename(id: string): string {
  return `pane-${id}.html`;
}

/** 按 `module.canvasStyles` 选取该 pane 应叠加的样式;不一致声明以 `BuildError` 终止。 */
function resolvePaneCss(module: PaneModule, canvasCss: string | undefined): string {
  if (module.canvasStyles !== true) return PANE_BASE_CSS;
  if (canvasCss === undefined) {
    throw new BuildError({
      stage: "pane",
      code: "BUILD_PANE_MISSING_CANVAS_CSS",
      detail:
        `pane "${module.id}" 声明了 canvasStyles: true,但本次构建未解析到画布样式` +
        `(调用方应先对全部画布 pane 调用一次 resolveCanvasCss() 后传入 canvasCss)。`,
      path: typeof module.entry === "string" ? module.entry : undefined,
    });
  }
  return canvasCss;
}

/**
 * 打包单个 pane 入口,注入单例插件;esbuild 失败包装为 `BuildError`(stage:"pane")。
 *
 * ★ `plugins` 的类型断言:`createReactSingletonPlugin` 与 `bundlePaneEntry` 分处两个包
 * (`server/cli/build` 消费根 `esbuild@^0.28.1`,`packages/web-kit` 自身声明
 * `esbuild@^0.24.0`),pnpm 因版本范围不同各自 hoist 出物理不同的 esbuild 安装——两侧
 * `Plugin` 类型结构性不兼容(如 `entryPoints` 在 0.28 新增了 `{in,out}` 联合成员),而
 * esbuild 插件运行时协议(`{name, setup(build)}`)本身在这两个次要版本间没有变化,双方
 * 实际互操作正常(见本文件测试的真实打包结果)。这是纯类型层面的跨包版本偏差,不在本任务
 * 边界内改动两个包各自的 `esbuild` 依赖版本声明。
 */
async function bundlePane(module: PaneModule, sourceRoot: string): Promise<string> {
  try {
    return await bundlePaneEntry({
      entry: module.entry,
      plugins: [createReactSingletonPlugin(sourceRoot)] as unknown as PaneBundleOptions["plugins"],
    });
  } catch (error) {
    throw new BuildError({
      stage: "pane",
      code: "BUILD_PANE_BUNDLE_FAILED",
      detail: `pane "${module.id}" 打包失败:${error instanceof Error ? error.message : String(error)}`,
      path: typeof module.entry === "string" ? module.entry : undefined,
    });
  }
}

/**
 * 为每个 pane 产出内联文档与可独立寻址的脚本、文档两类产物(design.md 流程步 6-7)。
 *
 * 逐 pane **顺序**处理(不用 `Promise.all`):保证 `files`/`artifacts` 的输出顺序与输入
 * `modules` 顺序一一对应,不因并发调度而漂移(「顺序稳定可复现」的完成态要求)。
 *
 * @param modules `discoverPaneModules` 产出的 `PaneDiscovery.modules`(非空——调用方在
 *   无 pane 声明时不应调用本函数,与 `assemblePanesManifest` 同一前提)。
 * @throws {BuildError} `stage:"pane"`——画布样式缺失或某个 pane 打包失败时。
 */
export async function buildPaneArtifacts(
  modules: readonly PaneModule[],
  options: PaneBuildOptions,
): Promise<PaneBuildResult> {
  await mkdir(options.outDir, { recursive: true });

  const files: string[] = [];
  const artifacts: PaneBuildArtifact[] = [];
  const documents: Record<string, string> = {};

  for (const module of modules) {
    const css = resolvePaneCss(module, options.canvasCss);
    const script = await bundlePane(module, options.sourceRoot);

    const scriptFilename = paneScriptFilename(module.id);
    const documentFilename = paneDocumentFilename(module.id);
    const scriptPath = join(options.outDir, scriptFilename);
    const documentPath = join(options.outDir, documentFilename);

    await writeFile(scriptPath, script, "utf8");
    await writeFile(documentPath, renderPaneUrlDocument(module.title, scriptFilename, css), "utf8");

    documents[module.id] = renderPaneDocument(module.title, script, css);
    files.push(scriptPath, documentPath);
    artifacts.push({ id: module.id, scriptPath, documentPath });
  }

  return { files, artifacts, documents };
}

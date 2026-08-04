/**
 * pane-discovery — pane 声明的约定发现与求值(spec cli-agent-build,任务 3.3,
 * Req 3.1, 3.2, 3.3, 3.4, 3.6;design.md「Components and Interfaces / pane-discovery」)。
 *
 * `pi-web build` 的第二阶段(design.md「System Flows」流程步 5):在 agent source 内按约定
 * 找到 pane 声明模块并求值,产出后续阶段(3.5 pane-build、3.6 panes-manifest)消费的
 * `PaneDiscovery`。不要求 agent source 提供任何构建脚本或构建入口函数(3.1)。
 *
 * ## 约定发现顺序(3.1、3.6),显式优先于约定,约定内包根汇总优先于逐目录
 *
 * 1. `--panes <path>`(`explicitPath`)—— 显式指定的**汇总声明模块**,3.6 的逃生口。给出但
 *    文件不存在按用户错误处理并终止,**不回落**到下一级——沉默回落会让打错路径的用户看到
 *    「无 pane」而非「路径错了」,更难定位。
 * 2. `<source>/panes/modules.ts` —— 包根汇总声明:一个模块 `export default` 一份
 *    {@link PanesModuleDeclarationInput},描述该 source 全部 pane。
 * 3. `<source>/panes/<id>/module.ts` —— 逐目录声明:每个目录一个 pane,`export default`
 *    一份 {@link PaneModule}。按目录名排序,使产物顺序稳定(沿用
 *    `scripts/build-builtin-panes.ts` 的 `discoverPanes().sort()` 纪律)。因为没有汇总文件,
 *    `panesId` 取 source 根目录名,`panelConfig`/`panesConfig` 缺省为空对象。
 *
 * 三级都未命中 → 返回 `undefined`,**不报错**(3.3:agent 允许一个 pane 都不声明,只构建
 * web 扩展产物)。
 *
 * ## 为什么必须 jiti 求值,不能静态解析(3.2)
 *
 * `capabilities.events` 的键可能是计算属性名(`[SOME_EVENT_CONST]: ...`),`entry` 依赖
 * `import.meta.url` 语义 —— 都无法在 AST/JSON 层面表达(design.md research.md F9)。因此
 * `load` 由调用方注入真实的 jiti `.import()`(`RunSubcommandDeps` 层面接线,任务 3.8),
 * 本模块只认「求值后的普通对象」,不做任何静态解析。若模块以 `export default { ... }` 形态
 * 导出(ESM 命名空间对象带 `default` 属性),自动解包;否则把 `load()` 的返回值本身当作声明
 * (便于单测用最简单的对象直接充当模块返回值)。
 *
 * ## entry 归一(3.2 / 7.1)
 *
 * - `URL` 实例 → `fileURLToPath`;协议不是 `file:` 时显式拒绝并给出可读错误(如声明模块想
 *   跨目录复用兄弟 example 的入口,仍须是本地文件的 `file:` URL,如
 *   `new URL("../other-agent/web/panes/entry.tsx", import.meta.url)`)。
 * - `string` → **相对声明模块自身所在目录**解析(与 `new URL(x, import.meta.url)` 语义
 *   一致),不引入第三种基准,不做协议判断(字符串形态天然只表达本地相对路径)。
 *
 * ## 声明模块契约(本任务在 design.md 字段契约之上补的落地细节)
 *
 * 汇总声明(约定 2、`--panes` 显式路径):
 * ```ts
 * export default {
 *   id: "aigc-canvas",                                   // → PaneDiscovery.panesId
 *   modules: [ { id, title, entry, capabilities, ... } ], // → PaneDiscovery.modules
 *   panelConfig: { initialPaneIds: [...], maxOpenPanes: 4 },  // 可省,缺省 {}
 *   panesConfig: { ... },                                 // 可省,缺省 {}
 * };
 * ```
 * 逐目录声明(约定 3):每个 `module.ts` 直接 `export default` 一个 {@link PaneModule}
 * (不含外层包装)。
 *
 * 结构不合法(缺字段、字段类型不对、entry 协议非法)一律以 `BuildError{stage:"discover"}`
 * 终止,并在 `path` 上携带出问题的具体声明文件路径(3.4)——这正是本 spec 起因的「结构漂移
 * 到运行期才炸」要在构建期提前暴露的那类校验之一(panes-manifest 的 `definePanes` 校验是
 * 更深一层的形态校验,3.5,不在本模块职责内)。
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";
import { BuildError } from "./errors.js";

/** pane 能力输入形态,借道 `PaneDefinitionInput` 取子字段,不新增 panes-kit 导出。 */
type PaneCapabilitiesInput = PaneDefinitionInput["capabilities"];

const PANES_DIR_NAME = "panes";
const AGGREGATE_MODULE_FILENAME = "modules.ts";
const PER_PANE_MODULE_FILENAME = "module.ts";

/**
 * 单个 pane 的构建期声明(design.md「pane-discovery」组件接口)。
 *
 * `entry` / `canvasStyles` 是构建期独占字段(research.md F10);`id` / `title` / `icon` /
 * `capabilities` 与运行期 `PaneDefinitionInput` 共用,互不重叠地扩展同一份声明。
 *
 * 本模块返回的实例中 `entry` **恒为已归一的绝对路径字符串**(`string | URL` 联合里的
 * `string` 分支)——保留联合类型是为了与 design.md 的字面契约一致,供下游(pane-build.ts)
 * 无需关心声明侧写的是 `URL` 还是相对字符串。
 */
interface PaneModuleBase {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly capabilities: PaneCapabilitiesInput;
}

/** 既有形态:给模块入口,由构建器打包成脚本再包进 HTML。 */
export interface PaneEntryModule extends PaneModuleBase {
  readonly entry: string | URL;
  readonly canvasStyles?: boolean;
  /** ★ 反字段,不是冗余:没有它 TS 无法据 `module.document !== undefined` 收窄联合。 */
  readonly document?: undefined;
}

/**
 * 新增形态:给**已渲染好的完整 HTML**,构建器原样写出(spec pane-build-prerendered-document)。
 *
 * 现实中确有这类 pane —— 不含 React、无需打包,自建构建脚本里只是取一段 HTML 常量做变量替换
 * 后写出。迁到 `pi-web build` 时这类 pane 在声明里无处安放,于是被**静默丢弃**:构建照样成功,
 * 产物目录里可能还留着上次写出的 `pane-<id>.html`,但 `panes.json` 不声明它,宿主便看不见。
 * (实证:aigc-agent 的 logs pane,panes.json 3 条而 dist 里有 4 份文档。)
 */
export interface PaneDocumentModule extends PaneModuleBase {
  /** 完整 HTML 文档。构建器不解释其内容,变量替换等由声明方自行完成。 */
  readonly document: string;
  readonly entry?: undefined;
}

/**
 * pane 声明的两种形态,`entry` 与 `document` **恰有其一**。
 *
 * 用判别联合而非「两个可选字段」:漏处理某一形态会是**编译错误**,而不是运行期少一个 pane
 * —— 后者正是本 spec 要根治的失败模式。
 */
export type PaneModule = PaneEntryModule | PaneDocumentModule;

/** `discoverPaneModules` 的成功产出。 */
export interface PaneDiscovery {
  /** pane 集合标识,对应运行期 `definePanes({id})`。 */
  readonly panesId: string;
  readonly modules: readonly PaneModule[];
  /** 面板级配置(如 `initialPaneIds`/`maxOpenPanes`),原样透传给后续阶段。 */
  readonly panelConfig: Readonly<Record<string, unknown>>;
  /** pane 集合级的额外配置,原样透传。 */
  readonly panesConfig: Readonly<Record<string, unknown>>;
  /** 命中的声明文件(或逐目录约定下的 `panes/` 目录),用于报错定位与诊断输出(3.4)。 */
  readonly origin: string;
}

/**
 * 求值单个模块文件的注入点(通常是 jiti 的 `.import()`)。单测可传入返回固定对象的替身,
 * 不必真的经 jiti 求值 TS 源码。
 */
export type PaneModuleLoader = (specifier: string) => Promise<unknown>;

/** 汇总声明模块的 `export default` 期望形态(仅用于内部类型标注,不对外导出)。 */
interface PanesModuleDeclarationInput {
  readonly id?: unknown;
  readonly modules?: unknown;
  readonly panelConfig?: unknown;
  readonly panesConfig?: unknown;
}

function invalidModuleError(detail: string, path: string): BuildError {
  return new BuildError({ stage: "discover", code: "BUILD_DISCOVER_INVALID_MODULE", detail, path });
}

/** 求值模块并解包 `export default`;`load()` 返回值本身没有 `default` 属性时,原样当作声明。 */
async function loadModuleDefault(moduleAbsolutePath: string, load: PaneModuleLoader): Promise<unknown> {
  let loaded: unknown;
  try {
    loaded = await load(moduleAbsolutePath);
  } catch (error) {
    throw new BuildError({
      stage: "discover",
      code: "BUILD_DISCOVER_LOAD_FAILED",
      detail: `加载 pane 声明模块失败:${error instanceof Error ? error.message : String(error)}`,
      path: moduleAbsolutePath,
    });
  }
  if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
    return (loaded as { default: unknown }).default;
  }
  return loaded;
}

/**
 * `entry` 归一(3.2 / 7.1)。`declaringModulePath` 是声明该 `entry` 的模块文件自身的绝对
 * 路径,字符串形态相对它所在目录解析,与 `import.meta.url` 语义一致。
 */
function normalizeEntry(entry: unknown, declaringModulePath: string, paneId: string): string {
  if (entry instanceof URL) {
    if (entry.protocol !== "file:") {
      throw invalidModuleError(
        `pane "${paneId}" 的 entry 使用了非 file: 协议(${entry.protocol}),仅支持指向本地文件的 URL。`,
        declaringModulePath,
      );
    }
    return fileURLToPath(entry);
  }
  if (typeof entry === "string" && entry.length > 0) {
    return resolve(dirname(declaringModulePath), entry);
  }
  throw invalidModuleError(
    `pane "${paneId}" 缺少合法的 "entry" 字段(须为非空字符串或指向本地文件的 URL)。`,
    declaringModulePath,
  );
}

/** 校验并归一单个 pane 声明对象为 {@link PaneModule};`declaringModulePath` 用于报错定位。 */
function normalizePaneModule(raw: unknown, declaringModulePath: string): PaneModule {
  if (typeof raw !== "object" || raw === null) {
    throw invalidModuleError("pane 声明必须是一个对象。", declaringModulePath);
  }
  const record = raw as Record<string, unknown>;

  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    throw invalidModuleError('pane 声明缺少合法的 "id" 字段(须为非空字符串)。', declaringModulePath);
  }

  const title = record.title;
  if (typeof title !== "string" || title.length === 0) {
    throw invalidModuleError(`pane "${id}" 缺少合法的 "title" 字段(须为非空字符串)。`, declaringModulePath);
  }

  const capabilities = record.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw invalidModuleError(`pane "${id}" 缺少合法的 "capabilities" 字段(须为对象)。`, declaringModulePath);
  }

  // ── 形态判定:entry 与 document 恰有其一 ────────────────────────────────────
  // 空串/非字符串的 document 一律按「未给出」处理,但要在 detail 里点明类型不符 ——
  // 否则用户会看到「必须二选一」却不明白自己明明给了 document。
  const rawDocument = record.document;
  const hasDocument = typeof rawDocument === "string" && rawDocument.length > 0;
  const hasEntry = record.entry !== undefined;
  if (hasEntry && rawDocument !== undefined) {
    throw invalidModuleError(
      `pane "${id}" 同时给出了 "entry" 与 "document",二者互斥 —— 打包入口与预渲染文档只能选一种。`,
      declaringModulePath,
    );
  }
  if (!hasEntry && !hasDocument) {
    const detail = rawDocument !== undefined
      ? `pane "${id}" 的 "document" 须为非空字符串(当前为 ${typeof rawDocument});也可改用 "entry" 给出模块入口。`
      : `pane "${id}" 必须给出 "entry"(模块入口)或 "document"(预渲染 HTML)之一。`;
    throw invalidModuleError(detail, declaringModulePath);
  }

  const icon = record.icon;
  if (icon !== undefined && typeof icon !== "string") {
    throw invalidModuleError(`pane "${id}" 的 "icon" 字段须为字符串。`, declaringModulePath);
  }

  const canvasStyles = record.canvasStyles;
  if (canvasStyles !== undefined && typeof canvasStyles !== "boolean") {
    throw invalidModuleError(`pane "${id}" 的 "canvasStyles" 字段须为布尔值。`, declaringModulePath);
  }

  const base = {
    id,
    title,
    capabilities: capabilities as PaneCapabilitiesInput,
    ...(icon !== undefined ? { icon } : {}),
  };

  if (hasDocument) {
    // 预渲染形态:canvasStyles 对它无意义(HTML 自带样式),给了也不静默忽略。
    if (canvasStyles !== undefined) {
      throw invalidModuleError(
        `pane "${id}" 同时给出了 "document" 与 "canvasStyles" —— 预渲染文档自带样式,不参与画布样式解析。`,
        declaringModulePath,
      );
    }
    return { ...base, document: rawDocument as string };
  }

  return {
    ...base,
    entry: normalizeEntry(record.entry, declaringModulePath, id),
    ...(canvasStyles !== undefined ? { canvasStyles } : {}),
  };
}

/** 校验 `panelConfig`/`panesConfig` 这类自由配置字段:缺省 `{}`,存在时须为(非数组)对象。 */
function normalizeConfigField(
  raw: unknown,
  field: "panelConfig" | "panesConfig",
  declaringModulePath: string,
): Readonly<Record<string, unknown>> {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidModuleError(`pane 汇总声明的 "${field}" 字段须为对象。`, declaringModulePath);
  }
  return raw as Record<string, unknown>;
}

/** 加载并校验约定 1/2 的「包根汇总声明」模块,产出完整 `PaneDiscovery`。 */
async function loadAggregateDeclaration(declarationPath: string, load: PaneModuleLoader): Promise<PaneDiscovery> {
  const loaded = await loadModuleDefault(declarationPath, load);
  if (typeof loaded !== "object" || loaded === null) {
    throw invalidModuleError("pane 汇总声明模块必须 export default 一个对象。", declarationPath);
  }
  const record = loaded as PanesModuleDeclarationInput;

  const panesId = record.id;
  if (typeof panesId !== "string" || panesId.length === 0) {
    throw invalidModuleError('pane 汇总声明缺少合法的 "id" 字段(须为非空字符串)。', declarationPath);
  }

  if (!Array.isArray(record.modules)) {
    throw invalidModuleError('pane 汇总声明缺少合法的 "modules" 字段(须为数组)。', declarationPath);
  }

  const modules = record.modules.map((raw) => normalizePaneModule(raw, declarationPath));
  const panelConfig = normalizeConfigField(record.panelConfig, "panelConfig", declarationPath);
  const panesConfig = normalizeConfigField(record.panesConfig, "panesConfig", declarationPath);

  return { panesId, modules, panelConfig, panesConfig, origin: declarationPath };
}

/**
 * 约定 3(逐目录声明):扫描 `<source>/panes/<dirName>/module.ts`,按目录名排序后逐一求值。
 * `panes/` 目录本身不存在,或存在但没有任何子目录带 `module.ts`,均返回 `undefined`
 * (由调用方判定「全不命中」,3.3)。
 */
async function discoverPerDirectoryDeclarations(
  sourceRoot: string,
  panesDir: string,
  load: PaneModuleLoader,
): Promise<PaneDiscovery | undefined> {
  let entries;
  try {
    entries = readdirSync(panesDir, { withFileTypes: true });
  } catch {
    return undefined; // panes/ 尚不存在 —— 不是错误,交由上一级判定「全不命中」。
  }

  const dirNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const modules: PaneModule[] = [];
  for (const dirName of dirNames) {
    const modulePath = join(panesDir, dirName, PER_PANE_MODULE_FILENAME);
    if (!existsSync(modulePath)) continue; // 目录里没有 module.ts —— 允许放辅助目录,跳过。
    const raw = await loadModuleDefault(modulePath, load);
    modules.push(normalizePaneModule(raw, modulePath));
  }

  if (modules.length === 0) return undefined;

  return {
    // 没有汇总文件可读 "id" —— 取 source 根目录名作缺省标识。
    panesId: basename(sourceRoot),
    modules,
    panelConfig: {},
    panesConfig: {},
    origin: panesDir,
  };
}

/**
 * 按约定发现 agent source 中声明的 pane 模块并求值(design.md 流程步 5)。
 *
 * @param sourceDir agent source 根(通常是 `resolveAgentSource` 的 `sourceRoot`)。
 * @param explicitPath `--panes <path>` 的逃生口(3.6);相对 `sourceDir` 解析,给出但文件
 *   不存在时以 `BuildError` 终止,不回落到约定 2/3。
 * @param load 求值单个模块文件的注入点(通常是 jiti `.import()`),便于单测替身。
 * @returns 三级约定均未命中时为 `undefined`(3.3,合法状态,不报错)。
 * @throws {BuildError} `stage:"discover"`——声明模块求值失败或结构不合法时(3.4)。
 */
export async function discoverPaneModules(
  sourceDir: string,
  explicitPath: string | undefined,
  load: PaneModuleLoader,
): Promise<PaneDiscovery | undefined> {
  const sourceRoot = resolve(sourceDir);

  if (explicitPath !== undefined) {
    const explicitAbsolute = resolve(sourceRoot, explicitPath);
    if (!existsSync(explicitAbsolute)) {
      throw new BuildError({
        stage: "discover",
        code: "BUILD_DISCOVER_EXPLICIT_PATH_NOT_FOUND",
        detail: `--panes 指定的声明模块不存在:${explicitAbsolute}`,
        path: explicitAbsolute,
      });
    }
    return loadAggregateDeclaration(explicitAbsolute, load);
  }

  const panesDir = join(sourceRoot, PANES_DIR_NAME);
  const aggregatePath = join(panesDir, AGGREGATE_MODULE_FILENAME);
  if (existsSync(aggregatePath)) {
    return loadAggregateDeclaration(aggregatePath, load);
  }

  return discoverPerDirectoryDeclarations(sourceRoot, panesDir, load);
}

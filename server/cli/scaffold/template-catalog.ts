/**
 * template-catalog — 枚举随包分发的骨架模板(spec cli-package-commands,任务 3.1,
 * Req 2.4, 2.5, 2.6)。
 *
 * 模板来源目录本身不由本模块决定拷贝或产出 —— `scripts/pack-dist.mjs` 的
 * `packExamples()` 早已把仓库根 `examples/` 整目录拷进产物 `dist/examples`(见该脚本
 * 注释)。本模块只**消费**一个已经存在的目录(开发期是仓库根 `examples/`,分发后是
 * `dist/examples/`),纯读地枚举其中带展示元数据(`package.json` 的 `pi-web` 字段)
 * 的子目录 —— 不新增任何拷贝步骤,不创建任何文件。
 *
 * 定位策略(刻意与枚举逻辑分离,避免在本模块内硬编码路径推断):
 * - `listTemplates` / `resolveTemplate` 只接受一个已解析好的 `examplesRoot` 字符串,
 *   本身是纯函数,不读 `import.meta.url`、不读 `process.cwd()`、不读产物根。
 * - `resolveExamplesRoot` 把「开发期 repo 根 examples/ vs 分发后产物根旁
 *   dist/examples/」这条不可测的判断收敛成一个纯函数:调用方按优先级构造候选路径
 *   数组(例如 `[join(distRoot, "examples"), join(repoRoot, "examples")]`),本函数
 *   只负责选出第一个真实存在的目录 —— 候选路径的构造(基于 `import.meta.url` 还是
 *   注入的产物根)留给未来接线任务(如 `server/cli/index.ts` 的 create 分支)决定,
 *   本任务不预判调用方如何取得这些候选值。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 模板未提供图标时的兜底展示符号。 */
const FALLBACK_AVATAR = "📦";
/** 模板未提供一句话描述时的兜底文案。 */
const FALLBACK_DESCRIPTION = "";

/** 单个模板的展示元数据,供 `pi-web create --list` 渲染。 */
export interface TemplateInfo {
  /** 模板名(即 examples 下的子目录名,也是 `--template <name>` 的取值)。 */
  readonly name: string;
  /** 展示标题;`pi-web.title` 缺失时回退为 `name`。 */
  readonly title: string;
  /** 展示图标;`pi-web.avatar` 缺失时回退为通用图标。 */
  readonly avatar: string;
  /** 一句话描述;`pi-web.description` 缺失时回退为空字符串。 */
  readonly description: string;
}

/** `resolveTemplate` 的判别联合结果 —— 未命中时返回结构化错误而非抛异常。 */
export type TemplateResolution =
  | { readonly ok: true; readonly template: TemplateInfo }
  | {
      readonly ok: false;
      readonly code: "TEMPLATE_NOT_FOUND";
      readonly name: string;
      readonly available: readonly string[];
    };

/** `package.json` 里与本模块相关的最小形状(其余字段本模块不关心,不做完整类型)。 */
interface PackageJsonShape {
  readonly "pi-web"?: {
    readonly title?: unknown;
    readonly avatar?: unknown;
    readonly description?: unknown;
  };
}

function readTemplateInfo(examplesRoot: string, dirName: string): TemplateInfo | undefined {
  const packageJsonPath = join(examplesRoot, dirName, "package.json");
  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: PackageJsonShape;
  try {
    parsed = JSON.parse(raw) as PackageJsonShape;
  } catch {
    return undefined;
  }

  const piWeb = parsed["pi-web"];
  if (piWeb === undefined || piWeb === null || typeof piWeb !== "object") return undefined;

  const title = typeof piWeb.title === "string" && piWeb.title.length > 0 ? piWeb.title : dirName;
  const avatar = typeof piWeb.avatar === "string" && piWeb.avatar.length > 0 ? piWeb.avatar : FALLBACK_AVATAR;
  const description = typeof piWeb.description === "string" ? piWeb.description : FALLBACK_DESCRIPTION;

  return { name: dirName, title, avatar, description };
}

/**
 * 枚举 `examplesRoot` 下带展示元数据(`package.json` 的 `pi-web` 字段)的子目录。
 *
 * 纯读:只调用 `readdirSync` / `readFileSync`,不写入、不创建任何文件。子目录缺
 * `package.json`、`package.json` 无法解析、或没有 `pi-web` 字段时静默跳过(不视为
 * 候选模板,不抛异常)—— 这与「候选模板 = 带展示元数据的目录」的定义一致(Req 2.4)。
 *
 * 结果按 `name` 升序排列,保证 `--list` 输出确定性。
 */
export function listTemplates(examplesRoot: string): readonly TemplateInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(examplesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const templates: TemplateInfo[] = [];
  for (const dirName of entries) {
    const info = readTemplateInfo(examplesRoot, dirName);
    if (info !== undefined) templates.push(info);
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 按名称解析单个模板(`pi-web create <name> --template <template>` 的校验接缝)。
 *
 * 未命中时返回判别联合 `{ ok: false, code: "TEMPLATE_NOT_FOUND", name, available }`,
 * **不抛异常**(design.md Error Handling:全部子命令错误以判别联合表达),`available`
 * 附带全部可用模板名供调用方拼错误文案(Req 2.6)。
 */
export function resolveTemplate(examplesRoot: string, name: string): TemplateResolution {
  const templates = listTemplates(examplesRoot);
  const found = templates.find((template) => template.name === name);
  if (found !== undefined) return { ok: true, template: found };
  return {
    ok: false,
    code: "TEMPLATE_NOT_FOUND",
    name,
    available: templates.map((template) => template.name),
  };
}

/**
 * 从候选路径中选出第一个真实存在的目录,作为 `examplesRoot`。
 *
 * 把「开发期 repo 根 `examples/` vs 分发后产物根旁 `dist/examples/`」这条不可测的
 * 路径推断收敛到此处的单一职责(是否存在),候选路径列表的构造(基于 `distServerJs()`
 * 产物根、`import.meta.url` 还是其他)由调用方按优先级传入 —— 本函数不做任何推断,
 * 因此可以用纯粹的临时目录布局来单测,不涉及真实的 `import.meta.url` 解析。
 *
 * 全部候选都不存在时返回 `undefined`,交由调用方决定报错文案(超出本任务边界)。
 */
export function resolveExamplesRoot(
  candidates: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return candidates.find((candidate) => exists(candidate));
}

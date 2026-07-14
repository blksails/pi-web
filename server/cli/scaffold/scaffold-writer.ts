/**
 * scaffold-writer — 拷贝模板并重写包身份(spec cli-package-commands,任务 3.2,
 * Req 2.1, 2.2, 2.3, 2.7, 2.8, 2.9, 2.11)。
 *
 * 仅消费任务 3.1 落地的 `TemplateCatalog`(`resolveTemplate`)定位模板源目录 —— 本模块
 * 不做任何路径推断(`examplesRoot` 由调用方解析好后传入,与 `template-catalog.ts` 同规则)。
 *
 * 关键裁定(供后续 6.1 接线与复核参考):
 *
 * 1. **模板 ↔ kind 的默认映射不在本模块**:`ScaffoldRequest.templateName` 已由调用方
 *    (未来的 `CreateCommand`,任务 6.1)解析确定 —— 若用户显式 `--template`,以其为准;
 *    否则调用方按 `kind` 选默认模板名(`agent` → `minimal-agent`,`plugin` →
 *    `plugin-code-review-agent`)。本模块的职责边界止于「给定 templateName,拷贝并重写」,
 *    不做 kind→模板名 的映射决策,理由:design.md 的 `ScaffoldRequest` 已经把
 *    `templateName` 列为独立输入字段(而非只给 `kind` 让本模块自己挑模板),说明这层映射
 *    决策意图上属于调用方。
 *
 * 2. **`pi-web.json` 对全部 kind 一视同仁地显式写出**:Req 2.3 要求「生成的 pi-web.json
 *    中显式写出包类型字段」,未限定只对 plugin 生效;而现有 `minimal-agent` 模板本身
 *    没有 `pi-web.json`(agent 骨架历来靠 `package.json` 的 `pi-web.*` 展示字段,不含
 *    机器可读的包身份清单)。若只在模板自带 `pi-web.json` 时才写(即只对 plugin 生效),
 *    agent 骨架将没有任何「显式 kind 字面值」的落地位置,Req 2.3 的观察态(读回清单校验
 *    kind 是字面值而非 schema 缺省补出)对 agent 分支就无法验证。故本模块对**每一次**
 *    scaffold 调用都确保目标目录含 `pi-web.json` 且其 `kind` 字段等于 `req.kind` 的字面值:
 *    模板自带则以其为基底只重写 `kind`;模板不带则合成最小清单
 *    `{ id: req.name, version: "0.1.0", kind: req.kind }`。
 *    `version` 取 `"0.1.0"` 而非模板已有版本号(骨架是全新包,不该继承模板自身的版本历史);
 *    模板自带清单时保留其原有 `version`(视为作者对该模板版本的选择,不强行归零)。
 *
 * 3. **返回值扩展 `absolutePath`/`nextStepHint`**:design.md 的 Service Interface 只声明
 *    `Promise<Result<{ createdAt }, ScaffoldError>>`,但 Req 2.11 要求「输出生成物绝对路径
 *    与下一步命令提示」。本模块不拥有终端输出(无 `ProgressReporter` 依赖,design 的
 *    Dependencies 只列 `TemplateCatalog`),但**返回值**可以承载这两项数据,交由调用方
 *    (6.1 的 `CreateCommand`)决定如何呈现 —— 这是对 design 字面接口的最小必要扩展,
 *    不改变其判别联合形状,只是成功分支多两个字段。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { PI_WEB_MANIFEST_FILENAME, type PluginKind } from "@blksails/pi-web-protocol";
import { resolveTemplate } from "./template-catalog.js";

/** 骨架生成请求(design.md `ScaffoldRequest`)。 */
export interface ScaffoldRequest {
  /** 用户提供的包名,写入生成物 `package.json` 的 `name` 与合成清单的 `id`。 */
  readonly name: string;
  /** 包类型,决定写入 `pi-web.json` 的显式 `kind` 字面值。 */
  readonly kind: PluginKind;
  /** 模板名(已由调用方按 `TemplateCatalog.resolveTemplate` 校验存在)。 */
  readonly templateName: string;
  /** 生成物落盘目标目录(绝对或相对路径;相对路径按 `process.cwd()` 绝对化)。 */
  readonly targetDir: string;
}

/** `scaffold()` 失败态的判别联合(design.md `ScaffoldError`)。 */
export type ScaffoldError =
  | { readonly code: "TARGET_NOT_EMPTY"; readonly path: string }
  | { readonly code: "TEMPLATE_NOT_FOUND"; readonly name: string; readonly available: readonly string[] };

/** 通用二态结果,`ok: true` 携带成功值,`ok: false` 携带判别联合错误。 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** `scaffold()` 成功态的负载。 */
export interface ScaffoldSuccess {
  /** 生成完成时刻(ISO 8601)。 */
  readonly createdAt: string;
  /** 生成物的绝对路径(Req 2.11)。 */
  readonly absolutePath: string;
  /** 下一步可执行的命令提示(Req 2.11),例如 `pi-web <absolutePath>`。 */
  readonly nextStepHint: string;
}

/** pi 生态用于发现包的关键字(design.md Req 2.9)。 */
const PI_PACKAGE_KEYWORD = "pi-package";

/** 合成骨架的缺省版本号(骨架是全新包,不继承模板自身的版本历史)。 */
const SCAFFOLD_DEFAULT_VERSION = "0.1.0";

/** `package.json` 里本模块需要重写/读取的最小形状,其余字段原样透传。 */
interface PackageJsonShape {
  name?: unknown;
  private?: unknown;
  keywords?: unknown;
  [key: string]: unknown;
}

/** 目标目录是否已存在且非空(存在但为空目录视为可写入)。 */
function isTargetOccupied(targetDir: string): boolean {
  if (!existsSync(targetDir)) return false;
  return readdirSync(targetDir).length > 0;
}

/** 重写 `package.json`:name 替换为用户提供名称、移除 private、补 pi-package 关键字。 */
function rewritePackageJson(targetDir: string, name: string): void {
  const packageJsonPath = join(targetDir, "package.json");
  const raw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as PackageJsonShape;

  pkg.name = name;
  delete pkg.private;

  const existingKeywords = Array.isArray(pkg.keywords)
    ? (pkg.keywords as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  pkg.keywords = existingKeywords.includes(PI_PACKAGE_KEYWORD)
    ? existingKeywords
    : [...existingKeywords, PI_PACKAGE_KEYWORD];

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * 确保目标目录含 `pi-web.json` 且其 `kind` 为 `kind` 的显式字面值。
 * 模板自带清单则以其为基底只重写 `kind`;不带则合成最小清单。
 */
function ensureManifestKind(targetDir: string, name: string, kind: PluginKind): void {
  const manifestPath = join(targetDir, PI_WEB_MANIFEST_FILENAME);

  let manifest: Record<string, unknown>;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } else {
    manifest = { id: name, version: SCAFFOLD_DEFAULT_VERSION };
  }

  manifest.kind = kind;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * 从模板拷贝骨架到目标目录,并重写包身份字段。
 *
 * 失败态一律先于任何文件系统写操作被判定(模板未找到 / 目标已占用),故失败时目标目录
 * 不被创建、不被修改(Req 2.7 的「不修改任何既有文件」)。
 */
export async function scaffold(
  req: ScaffoldRequest,
  examplesRoot: string,
): Promise<Result<ScaffoldSuccess, ScaffoldError>> {
  const resolved = resolveTemplate(examplesRoot, req.templateName);
  if (!resolved.ok) {
    return {
      ok: false,
      error: { code: "TEMPLATE_NOT_FOUND", name: resolved.name, available: resolved.available },
    };
  }

  const targetDir = isAbsolute(req.targetDir) ? req.targetDir : resolvePath(req.targetDir);
  if (isTargetOccupied(targetDir)) {
    return { ok: false, error: { code: "TARGET_NOT_EMPTY", path: targetDir } };
  }

  const templateDir = join(examplesRoot, req.templateName);
  mkdirSync(targetDir, { recursive: true });
  cpSync(templateDir, targetDir, { recursive: true });

  rewritePackageJson(targetDir, req.name);
  ensureManifestKind(targetDir, req.name, req.kind);

  return {
    ok: true,
    value: {
      createdAt: new Date().toISOString(),
      absolutePath: targetDir,
      nextStepHint: `pi-web ${targetDir}`,
    },
  };
}

/**
 * agent-source — 定位 agent source 根、探测可识别的 web 扩展源、解析产物目录
 * (spec cli-agent-build,任务 3.1,Req 1.3, 4.1, 5.1, 7.1)。
 *
 * `pi-web build` 的第一阶段(design.md「System Flows」流程步 3):`sourceDir` 缺省取
 * `process.cwd()`(1.3),不要求与 pi-web 仓库保持任何相对路径关系(4.1)。仓内实测有
 * **两种既有 webext 源目录约定**并存(见 `WEBEXT_SOURCE_DIR_CONVENTIONS` 注释),必须都
 * 能识别;两者都探测不到时以 `BuildError{stage:"resolve"}` 终止并说明两种期望位置(7.1)。
 *
 * 产物目录(5.1)缺省为协议约定 `DEFAULT_WEBEXT_DIST`(`.pi/web/dist`),但若 `pi-web.json`
 * 显式声明了 `web.dist`,则遵从该覆盖——与 `server/cli/publish/manifest-compiler.ts` 判定
 * webext 产物路径时「显式优先」的既有优先级完全一致(避免 build 与 publish 对「产物在哪」
 * 各判一套,重蹈本 spec 起因的结构漂移)。`pi-web.json` 本身对 webext 源是可选的(纯代码
 * webext 不必有它),故读取失败(不存在/JSON 非法/结构不合法)一律按「未声明覆盖」处理,
 * 不在此阶段报错——那是 `publish` 的校验强度,不是 `build` 的(design.md「Boundary Commitments」
 * 已把 pi-web.json 结构校验划给 publish,本命令只借它读一个可选字段)。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_WEBEXT_DIST,
  PI_WEB_MANIFEST_FILENAME,
  PiWebManifestSchema,
  type PiWebManifest,
} from "@blksails/pi-web-protocol";
import { BuildError } from "./errors.js";

/**
 * `entryDir` 内可被识别为 webext 入口的候选文件名,按优先级排列。
 *
 * ★ 必须与 `packages/web-kit/build/build.ts` 的私有 `resolveEntry()` 候选列表保持一致——
 *   该函数未导出为公开 API,故此处独立维护一份。若两处出现分歧,会出现「agent-source 判定
 *   有源,但后续真正打包时 `buildWebExtension` 内部的 `resolveEntry` 却找不到入口」这种静默
 *   错位;修改任一处候选列表时须同步核对另一处。
 */
const WEBEXT_ENTRY_CANDIDATES = ["web.config.tsx", "web.config.ts", "index.tsx", "index.ts"] as const;

/**
 * webext 源目录的既有约定,按优先级排列(实测仓内两者并存,见 requirements.md Boundary
 * Context 与本 spec research):
 *
 *  1. `.pi/web` —— 与产物目录 `.pi/web/dist` 同树,是 `packages/protocol` 的
 *     `WEBEXT_SOURCE_CONFIG`(`.pi/web/web.config.tsx`)所属约定,仓内 13/19 个 webext 示例
 *     采用(如 `examples/webext-layout-agent`)。
 *  2. `web` —— canvas pane 系示例采用,源与产物分离、产物仍写 `.pi/web/dist`(如
 *     `examples/aigc-canvas-agent`)。
 *
 * 顺序即优先级:两者都命中时(实践中不会同时出现,但探测逻辑仍需确定性)取 `.pi/web`。
 */
const WEBEXT_SOURCE_DIR_CONVENTIONS = [".pi/web", "web"] as const;

/** `resolveAgentSource` 的定位结果。 */
export interface AgentSourceLocation {
  /** agent source 根(绝对路径)。 */
  readonly sourceRoot: string;
  /** 命中的 webext 源目录(绝对路径)——即将传给 `buildWebExtension` 的 `entryDir`。 */
  readonly webextEntryDir: string;
  /** 产物目录(绝对路径)。honors `pi-web.json#web.dist` 显式覆盖,否则用 `DEFAULT_WEBEXT_DIST`。 */
  readonly outDir: string;
  /**
   * 解析出的 `pi-web.json`(若存在且结构合法)。供后续阶段(如 3.8 编排 `buildWebExtension`
   * 的 `id`)按需读取;不存在或不合法时为 `undefined`——webext 源允许无此清单。
   */
  readonly manifest?: PiWebManifest;
}

/** 可注入的文件系统读取依赖,供单测在不落盘的前提下驱动纯逻辑(与 `resolveExamplesRoot` 同一模式)。 */
export interface ResolveAgentSourceDeps {
  /** 存在性判定,缺省 `existsSync`。 */
  readonly exists?: (path: string) => boolean;
  /** 文件读取,缺省 `readFileSync(path, "utf8")`。 */
  readonly readFile?: (path: string) => string;
}

/** 按 `WEBEXT_SOURCE_DIR_CONVENTIONS` 顺序探测第一个含可识别入口文件的目录。 */
function findWebextEntryDir(sourceRoot: string, exists: (path: string) => boolean): string | undefined {
  for (const dir of WEBEXT_SOURCE_DIR_CONVENTIONS) {
    const entryDir = join(sourceRoot, dir);
    if (WEBEXT_ENTRY_CANDIDATES.some((file) => exists(join(entryDir, file)))) return entryDir;
  }
  return undefined;
}

/** 读取并校验 `pi-web.json`;不存在或不合法一律返回 `undefined`,不抛错(见文件头注释)。 */
function readManifest(
  sourceRoot: string,
  exists: (path: string) => boolean,
  readFile: (path: string) => string,
): PiWebManifest | undefined {
  const manifestPath = join(sourceRoot, PI_WEB_MANIFEST_FILENAME);
  if (!exists(manifestPath)) return undefined;
  try {
    const parsed = PiWebManifestSchema.safeParse(JSON.parse(readFile(manifestPath)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 定位 agent source 根、探测 webext 源目录、解析产物目录(design.md 流程步 3)。
 *
 * @param sourceDir 位置参数缺省时传 `undefined`,内部回落 `process.cwd()`(Req 1.3)。
 * @throws {BuildError} `stage:"resolve"`——两种既有目录约定均未探测到可识别的入口文件时(Req 7.1)。
 */
export async function resolveAgentSource(
  sourceDir: string | undefined,
  deps: ResolveAgentSourceDeps = {},
): Promise<AgentSourceLocation> {
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const sourceRoot = resolve(sourceDir ?? process.cwd());

  const webextEntryDir = findWebextEntryDir(sourceRoot, exists);
  if (webextEntryDir === undefined) {
    const expected = WEBEXT_SOURCE_DIR_CONVENTIONS.map((dir) => join(sourceRoot, dir));
    throw new BuildError({
      stage: "resolve",
      code: "BUILD_RESOLVE_SOURCE_NOT_FOUND",
      detail:
        `未在 ${sourceRoot} 下找到可识别的 web 扩展源。请在以下两种既有目录约定之一放入` +
        `入口文件(${WEBEXT_ENTRY_CANDIDATES.join(" / ")}):\n` +
        expected.map((dir) => `  - ${dir}`).join("\n"),
      path: sourceRoot,
    });
  }

  const manifest = readManifest(sourceRoot, exists, readFile);
  const outDir = manifest?.web?.dist !== undefined ? resolve(sourceRoot, manifest.web.dist) : join(sourceRoot, DEFAULT_WEBEXT_DIST);

  return {
    sourceRoot,
    webextEntryDir,
    outDir,
    ...(manifest !== undefined ? { manifest } : {}),
  };
}

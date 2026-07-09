/**
 * component-source — `pi-web add` 的来源解析(spec cli-component-add,任务 3.1,
 * Req 2.1–2.5)。
 *
 * 复用既有机构、不扩其解析面(design §Boundary):
 *   - 形态判别与信任判据 = `source-resolver` 的 `resolveSource`(CLI 白名单,
 *     本地路径放开、git 须 pinned ref,与 `install` 同一套);
 *   - git 拉取 = `ensureGitSource`(clone + checkout,缓存去重)。
 *
 * 本文件新增的唯一语法是 **`#<子目录>` 片段**(Req 2.3):在交给白名单**之前**从
 * 实参末段剥离 —— 既有 git ref 固定语法用 `@<ref>`,`#` 空闲(research §1.5)。
 * 片段只对直连 git 形态有意义;本地目录实参不剥(目录名可能真含 `#`),本地场景
 * 直接把子目录写进路径即可。
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ensureGitSource, type GitSource } from "@blksails/pi-web-server";
import {
  PI_WEB_MANIFEST_FILENAME,
  PiWebManifestSchema,
  type PiWebManifest,
} from "@blksails/pi-web-protocol";
import { classifySourceForm, resolveSource, type Result } from "../install/source-resolver.js";

export type ComponentSourceError = {
  readonly code:
    | "source_form_unsupported"
    | "allowlist_rejected"
    | "source_fetch_failed"
    | "source_subdir_not_found"
    | "source_not_component"
    | "manifest_unreadable";
  readonly message: string;
};

export interface ResolvedComponentSource {
  /** 组件包根(绝对路径:本地目录本身,或 git 缓存工作树内的子目录)。 */
  readonly packRoot: string;
  /** 溯源 origin 标识(本地=`local:<绝对路径>`;git=`git:host/repoPath@ref[#subdir]`)。 */
  readonly origin: string;
  /** 已过 zod parse 的清单(业务校验归 manifest-validate,不在此处)。 */
  readonly manifest: PiWebManifest;
}

export interface ComponentSourceDeps {
  /** git 拉取(缺省 `ensureGitSource`);测试注入 fake 克隆。 */
  readonly ensureGit?: (src: GitSource, root?: string) => Promise<string>;
  readonly cwd?: string;
}

const USAGE_HINT =
  "v1 支持:本地目录(如 ./my-component 或 /abs/path)与 git 直连(如 git:github.com/org/repo@v1.0.0#packages/my-component);registry 名称解析归 v2";

/** 剥离末段 `#<子目录>`;仅当基串仍是直连形态时才生效(Req 2.3)。 */
export function splitSubdirFragment(arg: string): { base: string; subdir?: string } {
  const hash = arg.lastIndexOf("#");
  if (hash <= 0) return { base: arg };
  const base = arg.slice(0, hash);
  const subdir = arg.slice(hash + 1);
  if (subdir.length === 0) return { base };
  return { base, subdir };
}

async function readManifest(
  packRoot: string,
): Promise<Result<PiWebManifest, ComponentSourceError>> {
  let raw: string;
  try {
    raw = await readFile(path.join(packRoot, PI_WEB_MANIFEST_FILENAME), "utf8");
  } catch {
    return {
      ok: false,
      error: {
        code: "manifest_unreadable",
        message: `组件包根缺少 ${PI_WEB_MANIFEST_FILENAME}: ${packRoot}`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "manifest_unreadable",
        message: `${PI_WEB_MANIFEST_FILENAME} 不是合法 JSON: ${(err as Error).message}`,
      },
    };
  }
  const result = PiWebManifestSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: "manifest_unreadable",
        message: `${PI_WEB_MANIFEST_FILENAME} 结构非法: ${result.error.issues[0]?.message ?? "unknown"}`,
      },
    };
  }
  if (result.data.kind !== "component") {
    return {
      ok: false,
      error: {
        code: "source_not_component",
        message: `该包 kind 为 "${result.data.kind}",不是可安装的组件包(需要 kind:"component");组件车道与 install 车道的选型见 docs/component-installer-design.md §3`,
      },
    };
  }
  return { ok: true, value: result.data };
}

/**
 * 解析 `pi-web add` 的来源实参 → 组件包根 + origin + 已 parse 清单。
 * 不写目标 source 的任何字节(git 克隆落在既有缓存目录,不属目标)。
 */
export async function resolveComponentSource(
  arg: string,
  deps: ComponentSourceDeps = {},
): Promise<Result<ResolvedComponentSource, ComponentSourceError>> {
  const trimmed = arg.trim();
  const { base, subdir } = splitSubdirFragment(trimmed);
  // 本地目录实参不剥片段(目录名可能真含 `#`):基串非直连时按原串重判。
  const effective = classifySourceForm(base) === "direct" ? base : trimmed;
  const useFragment = effective === base && subdir !== undefined;

  const resolved = await resolveSource(effective, deps.cwd !== undefined ? { cwd: deps.cwd } : {});
  if (!resolved.ok) {
    if (resolved.error.code === "REGISTRY_NOT_IMPLEMENTED") {
      return {
        ok: false,
        error: {
          code: "source_form_unsupported",
          message: `无法解析来源 "${arg}"。${USAGE_HINT}`,
        },
      };
    }
    return {
      ok: false,
      error: { code: "allowlist_rejected", message: resolved.error.reason },
    };
  }
  if (resolved.value.via !== "direct") {
    // classifySourceForm 已判直连,registry 分支理论不可达;防御性收窄。
    return {
      ok: false,
      error: { code: "source_form_unsupported", message: `无法解析来源 "${arg}"。${USAGE_HINT}` },
    };
  }

  const source = resolved.value.source;
  if (source.kind === "npm") {
    return {
      ok: false,
      error: {
        code: "source_form_unsupported",
        message: `组件车道不支持 npm 来源(源码交付,无构建产物可装)。${USAGE_HINT}`,
      },
    };
  }

  let packRoot: string;
  let origin: string;
  if (source.kind === "local") {
    packRoot = source.path;
    origin = `local:${source.path}`;
    try {
      const st = await stat(packRoot);
      if (!st.isDirectory()) throw new Error("not a directory");
    } catch {
      return {
        ok: false,
        error: { code: "source_fetch_failed", message: `本地来源不是可读目录: ${packRoot}` },
      };
    }
  } else {
    const git: GitSource = {
      url: `https://${source.host}/${source.repoPath}.git`,
      ref: source.ref,
      host: source.host,
      repoPath: source.repoPath,
      refIsDefault: false,
    };
    const ensureGit = deps.ensureGit ?? ensureGitSource;
    let workTree: string;
    try {
      workTree = await ensureGit(git);
    } catch (err) {
      return {
        ok: false,
        error: { code: "source_fetch_failed", message: `git 来源拉取失败: ${(err as Error).message}` },
      };
    }
    packRoot = useFragment ? path.join(workTree, subdir) : workTree;
    origin = `git:${source.host}/${source.repoPath}@${source.ref}${useFragment ? `#${subdir}` : ""}`;
    if (useFragment) {
      try {
        const st = await stat(packRoot);
        if (!st.isDirectory()) throw new Error("not a directory");
      } catch {
        return {
          ok: false,
          error: {
            code: "source_subdir_not_found",
            message: `仓库内子目录不存在: #${subdir}(仓库 ${source.host}/${source.repoPath}@${source.ref})`,
          },
        };
      }
    }
  }

  const manifest = await readManifest(packRoot);
  if (!manifest.ok) return manifest;
  return { ok: true, value: { packRoot, origin, manifest: manifest.value } };
}

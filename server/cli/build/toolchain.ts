/**
 * toolchain — 消费壳层注入的候选路径,解析构建工具链与画布样式预设
 * (spec cli-agent-build,任务 3.2,Req 4.2, 4.4;design.md「Components and Interfaces
 * / CLI 编排层」`toolchain` 行、Requirements Traceability 4.2/4.4)。
 *
 * ## 为什么需要这一层(而不是让 esbuild/postcss/tailwindcss 的 `import` 自然失败)
 *
 * `pi-web build` 面向**仓库外**的 agent source(Req 4.1):这些包不是 agent 的依赖,而是
 * pi-web 侧承诺提供的工具链(Req 4.2)。分发形态下它们由 `scripts/pack-dist.mjs` 的
 * `RUNTIME_PACKAGES` hoist 进 `<distRoot>/node_modules`(spec 任务 1.3),开发形态下则在
 * `<pkgRoot>/node_modules`——`bin/pi-web.mjs` 的 `buildCandidatePathDeps()`(任务 1.5)已按
 * 「产物根优先、包根兜底」的既有模式构造好 `toolchainRootCandidates` / `stylePresetCandidates`
 * 两组候选并经 `RunSubcommandDeps` 注入,本模块是其**唯一消费方**。
 *
 * 若不在此处提前探测,安装不完整时错误会推迟到 `bundlePaneEntry`/`resolveCanvasCss` 内部的
 * `import "esbuild"` 才炸出,报出的是裸 `ERR_MODULE_NOT_FOUND`,既定位不到「这是 pi-web 安装
 * 不完整」这个真因,也可能在部分产物已写出后才失败(违反 Req 4.4「不产出不完整的产物」——
 * 本阶段(`stage:"toolchain"`)在 `design.md`「System Flows」流程步 4,先于任何写盘动作,
 * 抛错即天然满足「不产出任何产物」)。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "./errors.js";

/**
 * 构建所需的工具链包(design.md「Technology Stack」:esbuild 打包 pane/webext,
 * postcss + tailwindcss 编译画布样式,autoprefixer 是 tailwindcss 的既有 postcss 插件依赖)。
 * 与 `scripts/build-server.mjs` `EXTERNAL` 追加的四项、`package.json` 根 `dependencies`
 * 提升的三项(`postcss`/`tailwindcss`/`autoprefixer`,`esbuild` 本就是根依赖)同一份清单
 * ——改动任一处需同步核对另一处,避免探测覆盖面与实际分发面出现分歧。
 */
export const TOOLCHAIN_PACKAGES = ["esbuild", "postcss", "tailwindcss", "autoprefixer"] as const;

/** `resolveToolchain` 的解析结果。 */
export interface ToolchainPaths {
  /** 经验证、其下含全部 `TOOLCHAIN_PACKAGES` 的 `node_modules` 根(绝对路径)。 */
  readonly toolchainRoot: string;
  /** 画布样式预设 `tailwind-preset.ts` 的已解析绝对路径。 */
  readonly presetPath: string;
}

/** 可注入的存在性判定,供单测在不落盘的前提下驱动纯逻辑(与 `resolveExamplesRoot` 同一模式)。 */
export interface ResolveToolchainDeps {
  readonly exists?: (path: string) => boolean;
}

/**
 * 在候选 `node_modules` 根中,找到第一个**四项工具链包都在场**的根。
 *
 * 判定标准是 `<root>/<pkg>/package.json` 存在——只看目录存在会把「同名空目录」误判为
 * 已安装,只看包名目录不看 `package.json` 会漏掉安装中断产生的半份目录。
 */
function findCompleteToolchainRoot(
  candidates: readonly string[],
  exists: (path: string) => boolean,
): string | undefined {
  return candidates.find((root) =>
    TOOLCHAIN_PACKAGES.every((pkg) => exists(join(root, pkg, "package.json"))),
  );
}

/** 某候选根下缺失的工具链包清单(用于报错,`root` 不存在或全新时等价于「全部缺失」)。 */
function missingPackagesIn(root: string, exists: (path: string) => boolean): readonly string[] {
  return TOOLCHAIN_PACKAGES.filter((pkg) => !exists(join(root, pkg, "package.json")));
}

/**
 * 解析构建工具链与画布样式预设(design.md 流程步 4)。
 *
 * @param toolchainRootCandidates 候选 `node_modules` 根,按优先级排列(`bin/pi-web.mjs`
 *   `buildCandidatePathDeps().toolchainRootCandidates`)。
 * @param stylePresetCandidates 候选样式预设文件路径,按优先级排列(同上
 *   `.stylePresetCandidates`)。
 * @throws {BuildError} `stage:"toolchain"`——工具链根或预设文件任一缺失时,列出全部缺失项
 *   与已尝试过的候选路径(Req 4.4)。
 */
export function resolveToolchain(
  toolchainRootCandidates: readonly string[],
  stylePresetCandidates: readonly string[],
  deps: ResolveToolchainDeps = {},
): ToolchainPaths {
  const exists = deps.exists ?? existsSync;

  const toolchainRoot = findCompleteToolchainRoot(toolchainRootCandidates, exists);
  const presetPath = stylePresetCandidates.find((candidate) => exists(candidate));

  if (toolchainRoot !== undefined && presetPath !== undefined) {
    return { toolchainRoot, presetPath };
  }

  const missing: string[] = [];
  if (toolchainRoot === undefined) {
    if (toolchainRootCandidates.length === 0) {
      missing.push("构建工具链(esbuild/postcss/tailwindcss/autoprefixer):未注入任何候选路径");
    } else {
      const lines = toolchainRootCandidates
        .map((root) => `      - ${root}(缺:${missingPackagesIn(root, exists).join(", ") || "无(但整体判定未命中)"})`)
        .join("\n");
      missing.push(`构建工具链(esbuild/postcss/tailwindcss/autoprefixer):已尝试的候选根均不完整\n${lines}`);
    }
  }
  if (presetPath === undefined) {
    if (stylePresetCandidates.length === 0) {
      missing.push("画布样式预设(tailwind-preset):未注入任何候选路径");
    } else {
      const lines = stylePresetCandidates.map((p) => `      - ${p}`).join("\n");
      missing.push(`画布样式预设(tailwind-preset):已尝试的候选路径均不存在\n${lines}`);
    }
  }

  throw new BuildError({
    stage: "toolchain",
    code: "BUILD_TOOLCHAIN_MISSING",
    detail:
      `构建所需的工具链或样式预设在当前安装形态下不可用,已终止(不产出任何产物)。缺失项:\n` +
      missing.map((item) => `  - ${item}`).join("\n") +
      `\n请检查 pi-web 安装是否完整(重新安装,或在源码仓库内执行一次 \`pnpm build:dist\`)。`,
  });
}

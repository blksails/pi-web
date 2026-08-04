/**
 * isolated-entry — 隔离宿主自包含入口 + 运行时分派入口(统一入口)+ 完整性重算
 * (spec cli-agent-build,任务 3.7,Req 2.4, 2.5;design.md「Components and Interfaces」
 * `isolated-entry` 行、Requirements Traceability 2.4/2.5、「System Flows」流程步 10)。
 *
 * ## 两种宿主形态与两份产物
 *
 * `buildWebExtension`(任务 2.1,`packages/web-kit/build/build.ts`)产出的 `web-extension.mjs`
 * 是**同源**产物:react/react-dom 被 external 化,运行时靠宿主 import map 解析成单例——只在
 * 宿主与扩展共享同一 JS realm(有 import map)时可用。隔离宿主(pi-clouds 的 opaque-origin
 * 沙盒)不具备这个前提,因此需要一份**自包含**产物:react/react-dom 被内联进 bundle,靠
 * `createReactSingletonPlugin` 强制收敛到 agent source 根的单一副本(与 pane IIFE、URL 形态
 * 脚本同一纪律,见 `react-singleton.ts` 头注)。
 *
 * `entry` 字段(manifest 当前唯一的入口指针)不能直接指向其中一份——旧宿主与未来的隔离宿主
 * 消费的是同一个字段(`entries` 数组是 Phase 2 才落地的协议扩展,尚不普及,design.md「协议层
 * / manifest 双入口」)。因此本模块额外产出第三份**统一入口**(分派入口):运行时判别宿主
 * 形态,动态 `import()` 到对应产物——这份文件取代 `web-extension.mjs` 成为 manifest `entry`
 * 的实际指向(由 `runBuild` 编排层——任务 3.8——完成该项替换,本模块只产出字节)。
 *
 * ## 宿主形态探测约定(运行时,Req 2.4)
 *
 * 隔离宿主在挂载统一入口脚本**之前**把全局标记 {@link HOST_FORM_GLOBAL_FLAG} 置为
 * `true`;同源宿主(含全部既有宿主)零改动、不注入该标记,统一入口回落 `"same-origin"`
 * ——旧宿主无感继续可用。真实探测依赖浏览器宿主的全局环境,无法在 Node 单测进程里直接
 * 驱动,故 {@link resolveDispatchTarget} 把探测收敛成一个**可注入**的 `probe` 参数(缺省
 * {@link detectHostForm}),与 `resolveAgentSource`/`resolveToolchain` 同一 DI 范式——单测
 * 以桩替身替代真实宿主,分别驱动两种探测结果。
 *
 * ## 完整性重算(Req 2.5)
 *
 * 统一入口的字节可能在写出后被**改写**(如 `runBuild` 编排层按最终产物文件名回填分派目标
 * 后重新落盘)。任何改写后都必须重新调用 {@link recomputeIntegrity},否则 manifest 记录的
 * 校验值会与磁盘上的最终字节脱节——这正是本 spec 要根治的「结构漂移」在 integrity 维度的
 * 翻版,不能重蹈覆辙。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { build as esbuild } from "esbuild";
import { createReactSingletonPlugin } from "./react-singleton.js";
import { BuildError } from "./errors.js";

/** 统一入口探测宿主形态所读取的全局标记名(见文件头注释「宿主形态探测约定」)。 */
export const HOST_FORM_GLOBAL_FLAG = "__PI_WEB_ISOLATED_HOST__";

/** 宿主形态:`"same-origin"`(共享 import map)或 `"isolated"`(opaque-origin 沙盒)。 */
export type HostForm = "same-origin" | "isolated";

/** 宿主形态探测函数——可注入,供单测以桩替身替代真实宿主。 */
export type HostFormProbe = () => HostForm;

/**
 * 真实宿主形态探测(生产实现):读取 {@link HOST_FORM_GLOBAL_FLAG}。该探测只在真实浏览器
 * 宿主环境里有意义;Node 单测进程调用它恒得到 `"same-origin"`(全局标记未注入)——这正是
 * 为什么 {@link resolveDispatchTarget} 把它做成可覆盖的缺省值,而不是在分派逻辑里硬编码
 * 调用它。
 */
export function detectHostForm(): HostForm {
  const globalRecord = globalThis as Record<string, unknown>;
  return globalRecord[HOST_FORM_GLOBAL_FLAG] === true ? "isolated" : "same-origin";
}

/** 分派目标——自包含(隔离)产物与同源产物各自的相对路径(供统一入口引用)。 */
export interface DispatchTargets {
  /** 隔离(自包含)产物的相对路径,如 `"isolated-entry.mjs"`。 */
  readonly isolatedEntry: string;
  /** 同源产物的相对路径,如 `"web-extension.mjs"`。 */
  readonly sameOriginEntry: string;
}

/**
 * 按探测到的宿主形态,解析统一入口应分派到的产物相对路径(Req 2.4)。
 *
 * `probe` 缺省 {@link detectHostForm};单测传入桩替身,分别驱动 `"isolated"` /
 * `"same-origin"` 两种探测结果,断言各自解析到 `targets.isolatedEntry` /
 * `targets.sameOriginEntry`。
 */
export function resolveDispatchTarget(
  targets: DispatchTargets,
  probe: HostFormProbe = detectHostForm,
): string {
  return probe() === "isolated" ? targets.isolatedEntry : targets.sameOriginEntry;
}

/**
 * 计算字节的 SRI 摘要字符串(`sha384-<base64>`)。产物字节被改写后须重新调用本函数
 * 同步 manifest 记录的校验值(Req 2.5)。
 */
export function recomputeIntegrity(bytes: string | Uint8Array): string {
  const digest = createHash("sha384").update(bytes).digest("base64");
  return `sha384-${digest}`;
}

/** 自包含入口的缺省文件名。 */
export const DEFAULT_ISOLATED_ENTRY_FILENAME = "isolated-entry.mjs";

/** `buildIsolatedEntry` 的入参。 */
export interface BuildIsolatedEntryOptions {
  /** 已解析的入口绝对路径——与产出同源产物(`buildWebExtension`)使用的同一入口。 */
  readonly entry: string;
  /** react-singleton 解析基准(agent source 根,Req 4.3),与 pane/URL 形态脚本同一纪律。 */
  readonly sourceRoot: string;
  /** 写出的产物目录。 */
  readonly outDir: string;
  /** 产物文件名,缺省 {@link DEFAULT_ISOLATED_ENTRY_FILENAME}。 */
  readonly fileName?: string;
}

/** 产出的自包含入口产物。 */
export interface IsolatedEntryArtifact {
  readonly fileName: string;
  /** 写出的绝对路径。 */
  readonly path: string;
  readonly code: string;
  readonly integrity: string;
}

/**
 * 产出隔离宿主可用的自包含入口(design.md 流程步 10)。
 *
 * 与 `buildWebExtension` 打包同一个入口,但**不** external 化 react/react-dom——ESM 打包时
 * 注入 {@link createReactSingletonPlugin},强制解析收敛到 `sourceRoot`,使 bundle 自身携带
 * 唯一一份运行时库副本,不依赖隔离宿主提供 import map(「自包含」的含义)。
 *
 * @throws {BuildError} `stage:"isolated"`——esbuild 打包失败或未产出字节时。
 */
export async function buildIsolatedEntry(
  options: BuildIsolatedEntryOptions,
): Promise<IsolatedEntryArtifact> {
  const fileName = options.fileName ?? DEFAULT_ISOLATED_ENTRY_FILENAME;

  let code: string;
  try {
    const result = await esbuild({
      entryPoints: [options.entry],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      write: false,
      legalComments: "none",
      plugins: [createReactSingletonPlugin(options.sourceRoot)],
    });
    const out = result.outputFiles?.[0];
    if (out === undefined) {
      throw new Error(`esbuild 未产出文件(入口:${options.entry})`);
    }
    code = out.text;
  } catch (error) {
    throw new BuildError({
      stage: "isolated",
      code: "BUILD_ISOLATED_BUNDLE_FAILED",
      detail: `隔离入口打包失败:${error instanceof Error ? error.message : String(error)}`,
      path: options.entry,
    });
  }

  await mkdir(options.outDir, { recursive: true });
  const path = join(options.outDir, fileName);
  await writeFile(path, code, "utf8");

  return { fileName, path, code, integrity: recomputeIntegrity(code) };
}

/** 统一入口(分派)产物的缺省文件名——取代同源打包直出的同名文件,见文件头注释。 */
export const DEFAULT_DISPATCHER_FILENAME = "web-extension.mjs";

/** `buildDispatcher` 的入参。 */
export interface BuildDispatcherOptions extends DispatchTargets {
  /** 写出的产物目录。 */
  readonly outDir: string;
  /** 产物文件名,缺省 {@link DEFAULT_DISPATCHER_FILENAME}。 */
  readonly fileName?: string;
}

/** 产出的统一入口(分派)产物。 */
export interface DispatcherArtifact {
  readonly fileName: string;
  /** 写出的绝对路径。 */
  readonly path: string;
  readonly code: string;
  readonly integrity: string;
}

/**
 * 生成统一入口(分派入口)的源码文本(design.md 流程步 10)。
 *
 * 运行时在真实宿主中判别形态的逻辑,与 {@link resolveDispatchTarget} 同一约定
 * ({@link HOST_FORM_GLOBAL_FLAG})——但运行在**不同的 JS 运行时**(浏览器宿主 vs 本模块
 * 所在的 Node 构建进程),不能直接复用同一函数引用,因此这里把该约定序列化为源码字符串。
 */
/**
 * 把同级产物文件名转成**相对说明符**。
 *
 * ★ 不可省：ESM 解析器（浏览器 / Node / Vite）把裸说明符一律当**包名**解析，
 * 于是 `import("web-extension.same-origin.mjs")` 会去找一个同名的包并抛
 * `ERR_MODULE_NOT_FOUND` —— 产出的每个扩展都会在加载瞬间失败。实测这条曾把
 * `test/chat-app.test.tsx` / `page.render.test.tsx` / `chat-app-logs-wiring.test.tsx`
 * 三个文件打成「0 个用例执行」，而 vitest 汇总行仍显示一片绿。
 */
function relativeSpecifier(fileName: string): string {
  return fileName.startsWith("./") || fileName.startsWith("../")
    ? fileName
    : `./${fileName}`;
}

export function renderDispatcherSource(targets: DispatchTargets): string {
  const flag = JSON.stringify(HOST_FORM_GLOBAL_FLAG);
  const isolatedEntry = JSON.stringify(relativeSpecifier(targets.isolatedEntry));
  const sameOriginEntry = JSON.stringify(relativeSpecifier(targets.sameOriginEntry));
  return (
    `const isolated = globalThis[${flag}] === true;\n` +
    `export default await import(/* @vite-ignore */ isolated ? ${isolatedEntry} : ${sameOriginEntry});\n`
  );
}

/**
 * 产出统一入口(分派)产物并写盘(design.md 流程步 10)。
 *
 * 写出后立即调用 {@link recomputeIntegrity} 计算校验值——与写出字节同一次调用,天然不会
 * 脱节;调用方(`runBuild` 编排层)若在此之后仍需改写字节(如按最终产物文件名回填分派目标),
 * 须自行对改写后的字节再次调用 {@link recomputeIntegrity} 同步(Req 2.5)。
 */
export async function buildDispatcher(options: BuildDispatcherOptions): Promise<DispatcherArtifact> {
  const fileName = options.fileName ?? DEFAULT_DISPATCHER_FILENAME;
  const code = renderDispatcherSource(options);

  await mkdir(options.outDir, { recursive: true });
  const path = join(options.outDir, fileName);
  await writeFile(path, code, "utf8");

  return { fileName, path, code, integrity: recomputeIntegrity(code) };
}

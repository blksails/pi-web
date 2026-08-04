/**
 * runBuild — `pi-web build` 的编排入口:参数解析 → 阶段串接 → 统一进度/错误呈现
 * (spec cli-agent-build,任务 3.8,Req 1.5, 5.3, 5.4, 7.2, 7.3, 7.4;
 * design.md「Components and Interfaces / CLI 编排层 / runBuild」)。
 *
 * 本模块只做**编排**,不实现任何打包细节——每个阶段的真实工作已由前序任务落在同目录的
 * 姊妹模块:`agent-source.ts`(3.1 定位)、`toolchain.ts`(3.2 工具链)、`pane-discovery.ts`
 * (3.3 发现)、`pane-build.ts`(3.5 双形态)、`panes-manifest.ts`(3.6 清单)、
 * `react-singleton.ts`(3.4)、`isolated-entry.ts`(3.7 隔离入口)。全部依赖 web-kit/canvas-ui
 * 的打包原语只经 `buildWebExtension`(webext)与 `resolveCanvasCss`(画布样式)两个入口消费
 * (design.md「Allowed Dependencies」)。
 *
 * ## 阶段顺序与失败即止(design.md「System Flows」)
 *
 * resolve → toolchain → **清空产物目录**(见下)→ discover → pane(可选,discovery 为空集时
 * 跳过)→ webext → isolated(自包含入口 + 分派入口 + 重签 manifest)。任一阶段抛出即经
 * `reporter.fail()` 呈现并返回非零码,不再往下走(7.2)。
 *
 * ## 产物目录清空时机(Req 5.3, 5.4)
 *
 * 清空动作被安排在 **resolve + toolchain 两个只读预检都通过之后**、真正开始写任何文件
 * **之前**:任务描述本身写的是「构建前清空产物目录」,但若把清空提到 toolchain 预检之前,
 * 一次因宿主安装不完整而失败的调用会把上一次成功构建的产物一并抹掉——对一个「装好工具链
 * 后重跑就能修好」的问题而言这是不必要的破坏性副作用。把清空动作放在两项预检之后、写入之前,
 * 既满足「重新构建时以当前版本整体覆盖,不残留过时文件」(5.3/5.4)的字面要求,又不会因为
 * 一次可恢复的预检失败而破坏此前的可用产物。据此,`resolve`/`toolchain` 两个阶段失败时不做
 * 任何清理(它们发生在清空动作之前,outDir 未被本次调用触碰);`discover`/`pane`/`webext`/
 * `isolated` 四个阶段失败时会重新清空 outDir——保证失败退出时产物目录不残留本次调用写出的
 * 部分产物(完成态用语)。
 *
 * ## 统一分派入口的产出(Req 2.4/2.5 由 `isolated-entry.ts` 拥有,本模块只负责正确接线)
 *
 * `buildWebExtension` 直出的 `web-extension.mjs` 是**同源**产物;`buildDispatcher` 的缺省
 * 文件名同样是 `web-extension.mjs`(`isolated-entry.ts` 头注:「取代同源打包直出的同名文件」)
 * ——两者若都写向同一个文件名会互相覆盖。本模块因此:
 *
 *  1. 用**不带** `signKey` 的选项调用 `buildWebExtension`(先拿到未签名的原始产物与 manifest);
 *  2. 把它写出的 `web-extension.mjs` 改名为 `web-extension.same-origin.mjs`,腾出该文件名;
 *  3. 产出隔离自包含入口(`isolated-entry.mjs`)与统一分派入口(占用被腾出的
 *     `web-extension.mjs` 文件名);
 *  4. 以分派入口的**最终字节**重算 manifest 的 `entry`/`integrity`(Req 2.5),若指定了
 *     `--sign` 才在此处**唯一一次**签名——早签会在改写 entry/integrity 后变成一份指向错误
 *     字节的失效签名。
 *
 * 签名沿用 `packages/web-kit/build/manifest-emit.ts#signManifest` 完全相同的算法
 * (Ed25519 · `canonicalManifestBytes` · pkcs8 私钥),但**独立实现**而非导入它——该模块
 * 未经 `@blksails/pi-web-kit/build` 的 subpath exports 暴露(design.md「Allowed Dependencies」
 * 只允许 `buildWebExtension`/`pane-document` 两个入口),与 `isolated-entry.ts` 自身独立
 * 实现 SRI 摘要而不导入 `manifest-emit.ts#computeIntegrity` 同一取舍。
 */
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve as resolvePath } from "node:path";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
// `jiti` 此前只是 `packages/server`/`packages/runner` 的依赖(已在 `scripts/build-server.mjs`
// 的 EXTERNAL、`scripts/pack-dist.mjs` 的 RUNTIME_PACKAGES 登记,分发形态下必落
// `dist/node_modules/jiti`),但根 `package.json` 未把它列为**自身**依赖——pnpm 严格链接下
// 根 `node_modules` 因此没有它的符号链接,静态 `import "jiti"` 在本文件(属根包)会既过不了
// 类型检查也在开发形态下解析失败。本任务据此把 "jiti" 补进根 `devDependencies`(与
// `esbuild` 同一档:构建期工具,由 RUNTIME_PACKAGES 负责分发形态可用性,不必是生产依赖),
// 使本模块可以像消费 esbuild 一样直接 `import`,不必再借 `createRequire` 锚定别的 workspace
// 包去迂回解析(那条路径在分发形态下是否成立未经验证,直接补依赖是更简单可靠的修法)。
import { createJiti } from "jiti";
import { canonicalManifestBytes, type WebExtensionManifest } from "@blksails/pi-web-protocol";
import type { ProgressReporter, CliError } from "../reporter.js";
import type { RunSubcommandDeps } from "../index.js";
import { resolveAgentSource } from "./agent-source.js";
import { resolveToolchain } from "./toolchain.js";
import { discoverPaneModules, type PaneModuleLoader } from "./pane-discovery.js";
import { assemblePanesManifest } from "./panes-manifest.js";
import { BuildError, describeBuildError, type BuildStage } from "./errors.js";

/**
 * `pi-web build` 的解析后参数(design.md「runBuild / Service Interface」)。
 * 由 `parseArgs`(下方)从 argv 派生,导出仅为文档化与单测断言方便。
 */
export interface BuildArgs {
  /** 位置参数缺省时取 `process.cwd()`(Req 1.3)。 */
  readonly sourceDir: string;
  /** `--panes <path>`,3.6 的显式声明逃生口。 */
  readonly panesPath?: string;
  /** `--sign <ed25519PrivateKeyBase64Pkcs8>`,既有签名语义不变(Req 1.5)。 */
  readonly signKey?: string;
  /** `--out <path>`,相对 agent source 根解析;缺省沿用 `resolveAgentSource` 的产物目录。 */
  readonly outDir?: string;
}

/**
 * `.pi/web` / `web` 入口目录内可被识别的入口候选文件名。
 *
 * ★ 与 `agent-source.ts` 的 `WEBEXT_ENTRY_CANDIDATES`、`packages/web-kit/build/build.ts` 的
 * 私有 `resolveEntry()` 候选列表**同一份清单的第三处独立维护**——`agent-source.ts` 头注已
 * 明言这是既有的、被接受的权衡(该清单在 web-kit 内是私有实现细节,未导出为公开 API)。
 * 这里之所以需要再复一份,是因为隔离自包含入口(`buildIsolatedEntry`)需要**入口文件的
 * 绝对路径**,而 `resolveAgentSource` 只探测到「入口目录」、不回传具体命中了哪个候选文件。
 * 三处出现分歧会造成「resolve 阶段判定有源,但 isolated 阶段却解析不到入口」的静默错位——
 * 修改任一处需同步核对另外两处。
 */
const WEBEXT_ENTRY_CANDIDATES = ["web.config.tsx", "web.config.ts", "index.tsx", "index.ts"] as const;

/** 在 `entryDir` 内按既有优先级探测已命中的入口文件绝对路径。 */
function resolveWebextEntryFile(entryDir: string): string {
  for (const candidate of WEBEXT_ENTRY_CANDIDATES) {
    const full = join(entryDir, candidate);
    if (existsSync(full)) return full;
  }
  // 不应发生:resolveAgentSource 已用同一份候选列表验证过 entryDir 至少命中一个。
  throw new BuildError({
    stage: "webext",
    code: "BUILD_WEBEXT_ENTRY_NOT_FOUND",
    detail: `未在 ${entryDir} 找到可识别的入口文件(不应发生,resolve 阶段应已验证)。`,
    path: entryDir,
  });
}

/** 分派入口取代同源产物后,原始同源产物改落的文件名(见文件头注释「统一分派入口的产出」)。 */
const SAME_ORIGIN_ENTRY_FILENAME = "web-extension.same-origin.mjs";

/** 未显式声明时的兼容 API range(与仓内既有示例 `build.ts` 的硬编码值一致)。 */
const DEFAULT_TARGET_API_VERSION = "^0.5.0";

/**
 * 用 Ed25519 私钥(base64 pkcs8)对 manifest 规范化字节签名 —— 与
 * `packages/web-kit/build/manifest-emit.ts#signManifest` 同一算法(见文件头注释)。
 */
async function signManifestBytes(
  base: Omit<WebExtensionManifest, "signature">,
  privateKeyB64: string,
): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(privateKeyB64, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalManifestBytes(base));
  const sig = await webcrypto.subtle.sign({ name: "Ed25519" }, key, data);
  return Buffer.from(sig).toString("base64");
}

/** 求值 pane 声明模块的生产实现:以本文件为锚点构造 jiti,`.import()` 作为 `PaneModuleLoader`。 */
function createPaneModuleLoader(): PaneModuleLoader {
  const jiti = createJiti(import.meta.url);
  return (specifier: string) => jiti.import(specifier) as Promise<unknown>;
}

/** 非 `BuildError` 异常的兜底翻译;`BuildError` 自身的 `code`/`detail` 优先(保留精确阶段)。 */
function toCliError(fallbackStage: BuildStage, err: unknown): CliError {
  if (err instanceof BuildError) {
    return { code: err.code, message: describeBuildError(err) };
  }
  const message = err instanceof Error ? err.message : String(err);
  // ★ 绝不把 signKey 等敏感入参插进这里的兜底文案——redactSecrets 只按「像凭据」的模式匹配,
  // 一段不含键名上下文的裸 base64 私钥未必能被模式命中,唯一可靠的防线是从不拼接它(7.3)。
  return { code: `BUILD_${fallbackStage.toUpperCase()}_FAILED`, message: `[${fallbackStage}] ${message}` };
}

/** 失败即止的统一出口:按需清空 outDir(不残留本次调用的部分产物)、经 reporter 呈现、返回 1。 */
async function failStage(
  reporter: ProgressReporter,
  outDir: string | undefined,
  fallbackStage: BuildStage,
  err: unknown,
): Promise<number> {
  if (outDir !== undefined) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
  reporter.fail("build", toCliError(fallbackStage, err));
  return 1;
}

function usageError(reporter: ProgressReporter, message: string): number {
  reporter.fail("build", { code: "USAGE_ERROR", message });
  return 1;
}

/** CSS 标识符的合法字符集(webext id 会成为 `pw-<id>-` / `--pw-<id>-` 的一段)。 */
const CSS_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 解析 webext id。
 *
 * ★ **不能直接拿 `pi-web.json` 的 `id`**：那是**注册表包 id**，允许带命名空间斜杠
 * （如 `e2e/aigc-canvas-agent`）；而 webext id 是 **CSS scoping 的命名空间根**
 * （`packages/web-kit/build/css-scope-plugin.ts` 用它拼 `pw-${extId}-` 与
 * `--pw-${extId}-`），含斜杠会生成**非法 CSS 标识符**。实测 aigc-canvas 就拿到了带
 * 斜杠的 id，只因该示例恰好无 CSS 才没炸。
 *
 * 优先级：`--id` 显式指定 > `pi-web.json` 的 `web.id` > 包 id 剥掉命名空间段 > 目录名。
 */
export function resolveExtensionId(input: {
  readonly explicit?: string | undefined;
  readonly manifestId?: string | undefined;
  readonly webId?: string | undefined;
  readonly sourceRoot: string;
}): string {
  const candidate =
    input.explicit ??
    input.webId ??
    // 剥命名空间：`e2e/aigc-canvas-agent` → `aigc-canvas-agent`
    (input.manifestId !== undefined ? input.manifestId.split("/").pop() : undefined) ??
    basename(input.sourceRoot);
  if (!CSS_IDENT_RE.test(candidate)) {
    // 抛 BuildError 而非裸 Error：后者会绕过 reporter，把 Node 栈直接糊给用户（违 7.2）。
    throw new BuildError({
      stage: "webext",
      code: "BUILD_INVALID_EXT_ID",
      detail:
        `webext id ${JSON.stringify(candidate)} 不是合法的 CSS 标识符（它会成为样式作用域前缀 pw-<id>-）。\n` +
        `请用 --id 显式指定一个只含字母/数字/下划线/连字符、且不以数字开头的 id。`,
    });
  }
  return candidate;
}

/**
 * `pi-web build` 编排入口(design.md 流程步 2-10)。
 *
 * @param argv 子命令自身的参数(不含 `build` 词条本身)。
 * @param deps 与其余子命令共享的可注入依赖(`RunSubcommandDeps`);本命令消费
 *   `cwd`/`toolchainRootCandidates`/`stylePresetCandidates`。
 * @param reporter 统一进度/错误呈现通道(与其余子命令同一实例,由 `runSubcommand` 注入)。
 * @returns 成功 `0`;任一阶段失败非零(不抛异常)。
 */
export async function runBuild(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        panes: { type: "string" },
        sign: { type: "string" },
        out: { type: "string" },
        id: { type: "string" },
      },
    });
  } catch (err) {
    return usageError(reporter, err instanceof Error ? err.message : String(err));
  }

  const [positionalSourceDir] = parsed.positionals;
  const sourceDir = positionalSourceDir ?? deps.cwd ?? process.cwd();
  const signKey = parsed.values.sign;
  const panesPath = parsed.values.panes;

  reporter.start("build", sourceDir);

  // ── resolve(design.md 流程步 3;失败时 outDir 未知,无需清理) ─────────────────────────
  let location;
  try {
    location = await resolveAgentSource(sourceDir);
  } catch (err) {
    return failStage(reporter, undefined, "resolve", err);
  }

  const outDir = parsed.values.out !== undefined ? resolvePath(location.sourceRoot, parsed.values.out) : location.outDir;

  // ── toolchain(design.md 流程步 4;失败时 outDir 尚未被本次调用触碰,不清理) ──────────
  let toolchain;
  try {
    toolchain = resolveToolchain(deps.toolchainRootCandidates ?? [], deps.stylePresetCandidates ?? []);
  } catch (err) {
    return failStage(reporter, undefined, "toolchain", err);
  }

  // ★ 工具链相关模块**必须**延迟到 resolveToolchain 之后再载入。
  // `isolated-entry.ts` / `react-singleton.ts` 静态 import esbuild，`pi-web-kit/build`
  // 与 `canvas-ui/build/pane-document` 分别依赖 esbuild 与 postcss/tailwind。若在文件
  // 顶部静态引入，工具链缺失时模块加载阶段就先抛 ERR_MODULE_NOT_FOUND，根本走不到
  // resolveToolchain 的友好报错 —— 实测 e2e 里「工具链缺失应报 BUILD_TOOLCHAIN_MISSING」
  // 就是因此失败的，而 R4.4 要求的正是「缺失即以明确错误终止」。
  const [{ buildWebExtension }, { resolveCanvasCss }, { buildPaneArtifacts }, { buildIsolatedEntry, buildDispatcher }] =
    await Promise.all([
      import("@blksails/pi-web-kit/build"),
      import("@blksails/pi-web-canvas-ui/build/pane-document"),
      import("./pane-build.js"),
      import("./isolated-entry.js"),
    ]);

  // ── 清空产物目录(Req 5.3, 5.4;见文件头注释「产物目录清空时机」) ────────────────────
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // ── discover(design.md 流程步 5) ────────────────────────────────────────────────
  let discovery;
  try {
    discovery = await discoverPaneModules(location.sourceRoot, panesPath, createPaneModuleLoader());
  } catch (err) {
    return failStage(reporter, outDir, "discover", err);
  }

  // ── pane(design.md 流程步 6-8;discovery 为空集时整段跳过,3.3 纪律) ─────────────────
  let paneFiles: readonly string[] = [];
  let panesManifestPath: string | undefined;
  if (discovery !== undefined) {
    try {
      const needsCanvasCss = discovery.modules.some((module) => module.canvasStyles === true);
      const canvasCss = needsCanvasCss
        ? await resolveCanvasCss({
            presetPath: toolchain.presetPath,
            packageRoot: location.sourceRoot,
            // presetPath 形如 `<root>/packages/ui/tailwind-preset.ts` → 上两级即 packages/ 根。
            // 必须显式传：本模块在分发形态下由打包产物加载，被调方的 import.meta.url 自解析会错位。
            packagesRoot: resolvePath(toolchain.presetPath, "..", ".."),
          })
        : undefined;
      const paneResult = await buildPaneArtifacts(discovery.modules, {
        sourceRoot: location.sourceRoot,
        outDir,
        ...(canvasCss !== undefined ? { canvasCss } : {}),
      });
      paneFiles = paneResult.files;

      // ── R2.2 的内联半边：把 pane 内联文档落成源码侧的生成模块 ──────────────────
      // ★ 这一步不可省。内联文档若只留在内存里，R2.2「同时产出内联形态」在端到端层面
      // 就没有任何可观测产物，示例只能退而声明 `{kind:"html", src:"pane-x.html"}` ——
      // 而那是相对路径，宿主的构建期静态集成车道**没有 baseUrl**，PanesHost 又原样把
      // src 交给 iframe，最终会相对宿主页面解析成 `http://<host>/pane-x.html` 而 404。
      // 落成生成模块后，示例可继续用既有的 `{kind:"inline", srcDoc}` 形态（迁移前即如此，
      // `pane-documents.generated.d.ts` 垫片本就是为它存在的）。
      //
      // 写在 webext 打包**之前**：`web.config.tsx` 会 import 这个模块，打包时必须已存在。
      // 该文件是构建产物，由 .gitignore 排除（Req 5.2）。
      const generatedPath = join(location.webextEntryDir, "pane-documents.generated.ts");
      const generatedSource =
        `// 由 \`pi-web build\` 生成，请勿手工编辑；已被 .gitignore 排除。\n` +
        `export const paneDocuments = ${JSON.stringify(paneResult.documents, null, 2)} as const;\n`;
      await writeFile(generatedPath, generatedSource, "utf8");

      const sidecar = assemblePanesManifest(discovery);
      panesManifestPath = join(outDir, "panes.json");
      await writeFile(panesManifestPath, JSON.stringify(sidecar, null, 2), "utf8");
    } catch (err) {
      return failStage(reporter, outDir, "pane", err);
    }
  }

  // ── webext(design.md 流程步 9;不带 signKey——最终签名在 isolated 阶段对分派入口做) ──
  let webext;
  let extensionId: string;
  try {
    extensionId = resolveExtensionId({
      explicit: parsed.values.id,
      manifestId: location.manifest?.id,
      sourceRoot: location.sourceRoot,
    });
  } catch (err) {
    return failStage(reporter, outDir, "webext", err);
  }
  try {
    webext = await buildWebExtension({
      id: extensionId,
      targetApiVersion: DEFAULT_TARGET_API_VERSION,
      entryDir: location.webextEntryDir,
      outDir,
    });
  } catch (err) {
    return failStage(reporter, outDir, "webext", err);
  }

  // ── isolated:自包含入口 + 统一分派入口 + 重签 manifest(design.md 流程步 10) ────────
  let manifestPath: string;
  let dispatcherIntegrity: string;
  let isolatedIntegrity: string;
  let files: string[];
  try {
    const entryFile = resolveWebextEntryFile(location.webextEntryDir);
    await rename(webext.entryOut, join(outDir, SAME_ORIGIN_ENTRY_FILENAME));

    const isolated = await buildIsolatedEntry({ entry: entryFile, sourceRoot: location.sourceRoot, outDir });
    const dispatcher = await buildDispatcher({
      isolatedEntry: isolated.fileName,
      sameOriginEntry: SAME_ORIGIN_ENTRY_FILENAME,
      outDir,
    });

    const manifestBase: Omit<WebExtensionManifest, "signature"> = {
      id: webext.manifest.id,
      targetApiVersion: webext.manifest.targetApiVersion,
      // `entry` 继续指向**分派入口**：旧宿主的 zod schema 会 strip 掉 `entries`，
      // 只认得 `entry`，所以它必须保持向后可加载（design.md Phase 2 硬约束）。
      entry: dispatcher.fileName,
      integrity: dispatcher.integrity,
      // ★ `entries` 是真正带完整性的那一层。只写 `entry`+`integrity` 时，SRI 覆盖的
      // 仅是分派器那两行**对所有扩展都一样**的字节 —— 实测六个示例的 integrity 完全
      // 相同，等于把 SRI 从「绑定扩展代码」退化成常量，相对 agent-web-extension R9.3
      // 是实质倒退。真正的扩展代码在这两条里各自绑定自己的字节。
      entries: [
        {
          path: SAME_ORIGIN_ENTRY_FILENAME,
          integrity: webext.manifest.integrity ?? dispatcher.integrity,
          realm: "same-origin" as const,
        },
        {
          path: isolated.fileName,
          integrity: isolated.integrity,
          realm: "isolated" as const,
        },
      ],
      ...(webext.manifest.css !== undefined ? { css: webext.manifest.css } : {}),
      ...(webext.manifest.capabilities !== undefined ? { capabilities: webext.manifest.capabilities } : {}),
    };
    const finalManifest: WebExtensionManifest =
      signKey !== undefined ? { ...manifestBase, signature: await signManifestBytes(manifestBase, signKey) } : manifestBase;

    manifestPath = join(outDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(finalManifest, null, 2), "utf8");

    dispatcherIntegrity = dispatcher.integrity;
    isolatedIntegrity = isolated.integrity;
    files = [
      ...(panesManifestPath !== undefined ? [panesManifestPath] : []),
      ...paneFiles,
      join(outDir, SAME_ORIGIN_ENTRY_FILENAME),
      ...(webext.cssOut !== undefined ? [webext.cssOut] : []),
      isolated.path,
      dispatcher.path,
      manifestPath,
    ];
  } catch (err) {
    return failStage(reporter, outDir, "isolated", err);
  }

  // ── 成功:文件清单 + 关键完整性校验值(Req 7.4) ──────────────────────────────────
  reporter.complete(
    "build",
    `${files.length} 个产出文件写入 ${outDir}\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      `\n完整性: entry(分派入口)=${dispatcherIntegrity}; isolated-entry=${isolatedIntegrity}`,
  );
  return 0;
}

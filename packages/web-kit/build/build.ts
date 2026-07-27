/**
 * pi-web build — 编排(任务 2.2 / Req 6.1, 9.3)。
 *
 * 用 esbuild 把 `.pi/web` 入口打成自包含 ESM,react/react-dom/@blksails/pi-web-kit/ai 全部
 * external(运行时经宿主 import map 解析单例)。随后:externals 守卫 → CSS scoping →
 * 计算 SRI 产出 manifest。产物写入 outDir(`web-extension.mjs` + 可选 `ext.css` + `manifest.json`)。
 */
import { build as esbuild } from "esbuild";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import type { WebExtensionCapability, WebExtensionManifest } from "@blksails/pi-web-protocol";
import { assertNoBundledSingletons } from "./externals-guard.js";
import { scopeCss } from "./css-scope-plugin.js";
import { emitManifest } from "./manifest-emit.js";

/** 运行时必须保持 external 的单例。 */
export const EXTERNAL_SINGLETONS: readonly string[] = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "ai",
  "@blksails/pi-web-kit",
];

export interface BuildOptions {
  readonly id: string;
  readonly targetApiVersion: string;
  /** `.pi/web` 目录(含入口与可选 styles.css)。 */
  readonly entryDir: string;
  /** 入口文件名(相对 entryDir);缺省自动探测 web.config / index。 */
  readonly entryFile?: string;
  /** 产物目录。 */
  readonly outDir: string;
  /** 可选 CSS 文件名(相对 entryDir);缺省探测 styles.css。 */
  readonly cssFile?: string;
  /** 提供则用 Ed25519 私钥(base64 pkcs8)对 manifest 签名。 */
  readonly signKey?: string;
  readonly capabilities?: readonly WebExtensionCapability[];
  /**
   * 额外产一份**自包含**产物 `web-extension.isolated.mjs`(react / react-dom / jsx-runtime /
   * pi-web-kit 全部打进去,只留 `ai` external)。
   *
   * 为何需要:隔离宿主(opaque-origin iframe 车道)里的扩展跑在**独立 realm** —— 宿主的单例桥
   * (`globalThis.__PI_WEBEXT_SINGLETONS__`)在其中不存在,import map 也无从指向宿主实例,故
   * external 版无法加载。自包含版供这类宿主直接 `<script type="module" src>`。
   *
   * 两份并存、各司其职:同源宿主(pi-web 自身)恒用 external 版(`manifest.entry`),与宿主共享
   * 同一 React 实例;隔离宿主按**约定名**取 isolated 版,realm 内自成一体、经 RPC 与宿主通信。
   * manifest **不变**(仍指 external 版),故对既有宿主零影响。
   */
  readonly alsoSelfContained?: boolean;
}

export interface BuildResult {
  readonly entryOut: string;
  readonly cssOut?: string;
  readonly manifest: WebExtensionManifest;
  readonly cssErrors: readonly string[];
  /** `alsoSelfContained` 时的自包含产物路径(隔离宿主用;manifest 不含它)。 */
  readonly selfContainedOut?: string;
}

/** 隔离宿主取自包含产物的**约定名**(与 `manifest.entry` 并存,不入 manifest)。 */
export const SELF_CONTAINED_ENTRY_NAME = "web-extension.isolated.mjs";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveEntry(opts: BuildOptions): Promise<string> {
  if (opts.entryFile !== undefined) return join(opts.entryDir, opts.entryFile);
  for (const cand of ["web.config.tsx", "web.config.ts", "index.tsx", "index.ts"]) {
    if (await exists(join(opts.entryDir, cand))) return join(opts.entryDir, cand);
  }
  throw new Error(`找不到 .pi/web 入口(web.config.* / index.*)于 ${opts.entryDir}`);
}

export async function buildWebExtension(opts: BuildOptions): Promise<BuildResult> {
  const entry = await resolveEntry(opts);
  await mkdir(opts.outDir, { recursive: true });

  // 1) esbuild → ESM,单例 external
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    external: [...EXTERNAL_SINGLETONS],
    write: false,
    legalComments: "none",
  });
  const out = result.outputFiles?.[0];
  if (out === undefined) throw new Error("esbuild 未产出文件");
  const code = out.text;

  // 2) externals 守卫(内联单例则抛错)
  assertNoBundledSingletons(code);

  const entryBytes = Buffer.from(code, "utf8");
  const entryOutName = "web-extension.mjs";
  await writeFile(join(opts.outDir, entryOutName), code, "utf8");

  // 2.5) 可选:自包含产物(隔离宿主用)。同一入口、同一 jsx 配置,但把 react 系与 pi-web-kit
  //      **打进去** —— 隔离 iframe 是独立 realm,拿不到宿主单例桥。故此产物刻意**不过**
  //      externals 守卫(守卫是 external 版的不变量)。manifest 不含它,按约定名取用。
  let selfContainedOut: string | undefined;
  if (opts.alsoSelfContained === true) {
    const sc = await esbuild({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      // `ai` 仍 external:它只在类型/可选路径出现,打进来会显著膨胀且隔离 pane 用不到。
      external: ["ai"],
      define: { "process.env.NODE_ENV": '"production"' },
      minify: true,
      write: false,
      legalComments: "none",
    });
    const scOut = sc.outputFiles?.[0];
    if (scOut === undefined) throw new Error("esbuild 未产出自包含文件");
    selfContainedOut = join(opts.outDir, SELF_CONTAINED_ENTRY_NAME);
    await writeFile(selfContainedOut, scOut.text, "utf8");
  }

  // 3) CSS scoping(若有)
  let cssOutName: string | undefined;
  const cssErrors: string[] = [];
  const cssPath =
    opts.cssFile !== undefined
      ? join(opts.entryDir, opts.cssFile)
      : (await exists(join(opts.entryDir, "styles.css")))
        ? join(opts.entryDir, "styles.css")
        : undefined;
  if (cssPath !== undefined) {
    const raw = await readFile(cssPath, "utf8");
    const scoped = scopeCss(raw, opts.id);
    cssErrors.push(...scoped.errors);
    if (scoped.errors.length > 0) {
      throw new Error(
        `CSS scoping 失败(${opts.id}):\n  ${scoped.errors.join("\n  ")}`,
      );
    }
    cssOutName = "ext.css";
    await writeFile(join(opts.outDir, cssOutName), scoped.css, "utf8");
  }

  // 4) manifest + SRI(+ 可选 Ed25519 签名)
  const manifest = await emitManifest({
    id: opts.id,
    targetApiVersion: opts.targetApiVersion,
    entry: entryOutName,
    entryBytes,
    ...(cssOutName !== undefined ? { css: cssOutName } : {}),
    ...(opts.capabilities !== undefined ? { capabilities: opts.capabilities } : {}),
    ...(opts.signKey !== undefined ? { signKey: opts.signKey } : {}),
  });
  await writeFile(
    join(opts.outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return {
    entryOut: join(opts.outDir, entryOutName),
    ...(cssOutName !== undefined ? { cssOut: join(opts.outDir, cssOutName) } : {}),
    ...(selfContainedOut !== undefined ? { selfContainedOut } : {}),
    manifest,
    cssErrors,
  };
}

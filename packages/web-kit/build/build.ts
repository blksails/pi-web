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
}

export interface BuildResult {
  readonly entryOut: string;
  readonly cssOut?: string;
  readonly manifest: WebExtensionManifest;
  readonly cssErrors: readonly string[];
}

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
    manifest,
    cssErrors,
  };
}

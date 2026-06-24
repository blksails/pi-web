/**
 * extension-loader — 宿主侧运行时扩展加载器(任务 3.2 / Req 1.1, 1.2, 1.4, 6.x)。
 *
 * 流程:读 manifest → 安全门校验(extension-gate)→
 *   - 纯声明(无 entry):从 manifest.config 合成描述符,**零 bundle**(Tier 5)。
 *   - 代码扩展:fetch entry 字节 → 门控通过后,经 import map 把裸 specifier 解析到宿主
 *     单例,动态 `import()` 入口,取默认导出描述符。
 * 任何缺失/非法/拒绝 → 返回可回退结果(宿主用默认 UI),不抛、不崩。
 *
 * 依赖注入:`LoaderDeps` 让 fetch/import 可在测试中替身;`browserLoaderDeps()` 提供
 * 真实浏览器实现(动态 import 经 `new Function` 规避打包器静态改写)。
 */
import type { WebExtensionManifest } from "@blksails/protocol";
import { isDeclarativeOnly } from "@blksails/protocol";
import type { WebExtension } from "@blksails/web-kit";
import { verifyExtension, type GateOptions } from "./extension-gate.js";

export interface LoaderDeps {
  /** 取 entry 字节(SRI 校验用)。 */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** 动态 import 入口(裸 specifier 由预装 import map 解析到宿主单例)。 */
  importModule(url: string): Promise<{ default: WebExtension }>;
}

export type LoadOutcome =
  | { readonly status: "loaded"; readonly extension: WebExtension }
  | { readonly status: "declarative"; readonly extension: WebExtension }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "rejected"; readonly reason: string };

export interface LoadExtensionInput {
  readonly manifest: WebExtensionManifest;
  /** entry/css 所在的基址 URL(末尾含 `/`)。 */
  readonly baseUrl: string;
  readonly opts: GateOptions;
  readonly deps: LoaderDeps;
}

function joinUrl(base: string, rel: string): string {
  return base.endsWith("/") ? base + rel : `${base}/${rel}`;
}

export async function loadExtension(input: LoadExtensionInput): Promise<LoadOutcome> {
  const { manifest, baseUrl, opts, deps } = input;
  try {
    // 纯声明(Tier 5):零 bundle,仅校验版本后从 manifest.config 合成描述符。
    if (isDeclarativeOnly(manifest)) {
      const gate = await verifyExtension({ manifest, opts });
      if (!gate.ok) return { status: "rejected", reason: gate.reason };
      const extension: WebExtension = {
        manifestId: manifest.id,
        ...(manifest.config !== undefined ? { config: manifest.config } : {}),
      };
      return { status: "declarative", extension };
    }

    // 代码扩展:fetch 字节 → 门控(SRI/签名/版本)。
    const entryUrl = joinUrl(baseUrl, manifest.entry as string);
    const bytes = await deps.fetchBytes(entryUrl);
    const gate = await verifyExtension({ manifest, entryBytes: bytes, opts });
    if (!gate.ok) return { status: "rejected", reason: gate.reason };

    const mod = await deps.importModule(entryUrl);
    if (mod.default === undefined || typeof mod.default !== "object") {
      return { status: "rejected", reason: "扩展默认导出不是 WebExtension 描述符" };
    }
    return { status: "loaded", extension: mod.default };
  } catch (err) {
    return {
      status: "rejected",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 真实浏览器 LoaderDeps。动态 import 经 `new Function` 规避打包器把 import() 静态改写
 * (使外部 URL 在运行时由浏览器解析,配合 document <head> 预装的 import map)。
 */
export function browserLoaderDeps(): LoaderDeps {
  const dynamicImport = new Function("u", "return import(u)") as (
    u: string,
  ) => Promise<{ default: WebExtension }>;
  return {
    async fetchBytes(url): Promise<Uint8Array> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} 失败: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    importModule(url): Promise<{ default: WebExtension }> {
      return dynamicImport(url);
    },
  };
}

/**
 * 宿主 import map(裸 specifier → 宿主单例 URL)。应在 document <head> 静态注入
 * (早于任何模块加载;浏览器仅允许首个 import 前存在一张 import map)。
 */
export function buildImportMap(
  singletonUrls: Readonly<Record<string, string>>,
): { imports: Record<string, string> } {
  return { imports: { ...singletonUrls } };
}

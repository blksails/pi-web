/**
 * resolve-webext — 按源解析已装包内 webext 的核心逻辑(webext-package-install 任务 2.3)。
 *
 * 自描述发现:定位已装源的 `.pi/web/dist/manifest.json` → 校验 schema → 服务端验签
 * (WebextTrustService) → 产出 `{vetted manifest, baseUrl}`。无中心目录/全局注册表。
 *
 * 四种返回(对应 design 流程):
 *   - 无 webext 产物 → { found:false }(回退默认 UI,非错误)
 *   - manifest 非法 → { found:true, rejectedReason }
 *   - 签名不受信/校验失败 → { found:true, rejectedReason }
 *   - 通过 → { found:true, manifest(已背书), baseUrl }
 *
 * 纯逻辑 + 注入依赖(定位/读取/baseUrl 映射),HTTP 路由为薄封装。
 */
import { WebExtensionManifestSchema } from "@blksails/pi-web-protocol";
import type { WebextTrustService, VettedManifest } from "./webext-trust-service.js";

export interface WebextResolveResponse {
  readonly found: boolean;
  readonly manifest?: VettedManifest;
  /** 浏览器获取产物的基址(末尾含 /)。 */
  readonly baseUrl?: string;
  /** found 但被拒(非法/不受信)时的原因。 */
  readonly rejectedReason?: string;
}

export interface ResolveWebextDeps {
  /** 定位已装源的 `.pi/web/dist` 目录;无 webext 产物返回 undefined。 */
  locateDist(source: string): Promise<string | undefined>;
  /** 读取 dist 下 `manifest.json` 的原始 JSON;不存在返回 undefined。 */
  readManifestJson(distDir: string): Promise<unknown | undefined>;
  /** 由 dist 目录映射出浏览器可 fetch 的 baseUrl(末尾含 /)。 */
  toBaseUrl(distDir: string): string;
  readonly trust: WebextTrustService;
}

export async function resolveWebext(
  source: string,
  deps: ResolveWebextDeps,
): Promise<WebextResolveResponse> {
  const dist = await deps.locateDist(source);
  if (dist === undefined) return { found: false };

  const raw = await deps.readManifestJson(dist);
  if (raw === undefined) return { found: false };

  const parsed = WebExtensionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { found: true, rejectedReason: `manifest 非法: ${parsed.error.message}` };
  }

  const verdict = await deps.trust.verifyManifest(parsed.data);
  if (!verdict.ok) {
    return { found: true, rejectedReason: verdict.reason };
  }

  return { found: true, manifest: verdict.vetted, baseUrl: deps.toBaseUrl(dist) };
}

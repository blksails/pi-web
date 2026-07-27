/**
 * webext 运行时车道 · 按源解析扩展产物(纯逻辑 + 注入依赖)。
 *
 * 自描述发现:定位源的 `.pi/web/dist/manifest.json` → 校验 schema → 服务端验签 → 产出
 * `{ vetted manifest, baseUrl }`。无中心目录、无全局注册表。
 *
 * 四种返回:
 *   - 无 webext 产物   → `{ found:false }`(回退宿主默认 UI,**非错误**)
 *   - manifest 非法    → `{ found:true, rejectedReason }`
 *   - 签名不受信/失败  → `{ found:true, rejectedReason }`
 *   - 通过             → `{ found:true, manifest(已背书), baseUrl }`
 *
 * 三个定位/读取依赖由宿主注入,故同一份逻辑可服务本机磁盘源(pi-web 宿主)与
 * registry bundle / 云沙箱源(pi-clouds cloud 宿主)。
 */
import { WebExtensionManifestSchema } from "@blksails/pi-web-protocol";
import type { VettedManifest, WebextTrustService } from "./trust-contract.js";

export interface WebextResolveResponse {
  readonly found: boolean;
  readonly manifest?: VettedManifest;
  /** 浏览器获取产物的基址(末尾含 /)。 */
  readonly baseUrl?: string;
  /** found 但被拒(非法/不受信)时的原因。 */
  readonly rejectedReason?: string;
}

export interface ResolveWebextDeps {
  /** 定位源的 `.pi/web/dist` 目录(或其等价寻址键);无 webext 产物返回 undefined。 */
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

/**
 * `GET /api/webext/resolve?source=…` 的处理器工厂。
 * `getDeps` 惰性取依赖(宿主的 trust 常需异步装配),异常一律收敛为 `rejectedReason`,
 * 不让整条端点 500 —— 解析失败应降级为「宿主默认 UI」,而非中断页面。
 */
export function createWebextResolveHandler(
  getDeps: () => Promise<ResolveWebextDeps>,
): (url: URL) => Promise<Response> {
  return async (url: URL): Promise<Response> => {
    const source = url.searchParams.get("source");
    if (source === null || source.length === 0) {
      return new Response("source query required", { status: 400 });
    }
    let result: WebextResolveResponse;
    try {
      result = await resolveWebext(source, await getDeps());
    } catch (err) {
      result = { found: true, rejectedReason: err instanceof Error ? err.message : String(err) };
    }
    return Response.json(result);
  };
}

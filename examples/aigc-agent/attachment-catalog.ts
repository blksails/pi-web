/**
 * attachmentCatalog(A1b · 子进程侧,零改 vendor)——把宿主素材库(aigc_assets 图像)经上游
 * `@` catalog 范式注入对话,替代已删的拖拽注入接缝(attachmentsApiRef/addReference)。
 *
 * list/resolve 只在 agent 子进程执行,经 @aigc-agent/platform-client 走回调路由取业务数据
 * (父进程持 Supabase)。字节由 resolve 子进程 `fetch(displayUrl)` 取,**不过 RPC、不进 base64**
 * (合「图像只以引用流转」不变量);主进程只见 list 的纯数据投影(CatalogEntry),选中后 materialize
 * 落成正式 `att_` id。
 *
 * platform 不可用(stub/离线/无回调 token)或 listAssets 回调失败 → list 返 `[]`(优雅降级,同
 * persist-extension 姿态,**绝不 throw 进 @ 补全 loop**)。resolve 不可用则 throw(无字节可取,
 * 且只在用户真的选中 entry 时触发,不在补全热路径)。
 */
import type {
  AgentAttachmentCatalogDecl,
  CatalogEntry,
  CatalogResolved,
} from "@blksails/pi-web-agent-kit";
import {
  getPlatformContext,
  type AssetRecord,
  type PlatformClient,
} from "./platform-client.js";

/** @ 补全每次按键都会 list,给个上限;素材过多时靠 query 收敛。 */
const LIST_LIMIT = 50;

function metaStr(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function assetName(a: AssetRecord): string {
  // ponytail: meta.name || assetId。生成落库多带 name;缺则用 assetId,补全过滤体验降级但不崩。
  return metaStr(a.meta, "name") ?? a.assetId;
}

function toEntry(a: AssetRecord): CatalogEntry {
  const mimeType = metaStr(a.meta, "mimeType");
  return {
    id: a.assetId,
    name: assetName(a),
    ...(mimeType !== undefined ? { mimeType } : {}),
    // 素材内容不可变(一次生成落库),createdAt 作 version → materialize 幂等缓存稳定命中。
    ...(a.createdAt ? { version: a.createdAt } : {}),
  };
}

/**
 * 工厂:默认用真实 `getPlatformContext`;测试注入 fake platform。attachmentCatalog 的
 * list/resolve 签名固定(不可加参),故经此可选参数注入而非 mock 模块。
 */
export function createAttachmentCatalog(
  getPlatform: () => PlatformClient = getPlatformContext,
): AgentAttachmentCatalogDecl {
  return {
    async list(query: string): Promise<CatalogEntry[]> {
      const platform = getPlatform();
      if (!platform.available) return [];
      let items: readonly AssetRecord[];
      try {
        const page = await platform.listAssets({ kind: "image", limit: LIST_LIMIT });
        items = page.items;
      } catch {
        return []; // 回调失败亦降级,绝不 throw 进补全 loop
      }
      const q = query.trim().toLowerCase();
      return items
        .map(toEntry)
        .filter((e) => q === "" || e.name.toLowerCase().includes(q));
    },

    async resolve(entryId: string): Promise<CatalogResolved> {
      const platform = getPlatform();
      if (!platform.available) {
        throw new Error("platform unavailable: cannot resolve catalog entry");
      }
      const asset = await platform.getAsset(entryId);
      if (asset === undefined) {
        throw new Error(`catalog entry not found: ${entryId}`);
      }
      const res = await fetch(asset.displayUrl);
      if (!res.ok) {
        throw new Error(`catalog resolve fetch ${asset.displayUrl} → ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mimeType =
        metaStr(asset.meta, "mimeType") ??
        res.headers.get("content-type") ??
        "application/octet-stream";
      return { bytes, name: assetName(asset), mimeType };
    },
  };
}

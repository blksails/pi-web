/**
 * webext 运行时车道 · 验签契约(**只有类型,无实现**)。
 *
 * 「服务端验签 → 下发已背书 manifest」这一语义对所有宿主一致,故契约上提至包面;
 * 而具体实现(受信发布者注册表、Ed25519 校验、env 门控)因载体而异——本机磁盘宿主、
 * 云端 registry 宿主各有各的信任源——故**留在宿主侧**,经 `ResolveWebextDeps.trust` 注入。
 *
 * 不变量:验签机密**永不下发浏览器**;浏览器只拿去掉 `signature`、标了
 * `signaturePreVerified` 的 manifest,自己再按 `integrity` 做 SRI。
 */
import type { WebExtensionManifest } from "@blksails/pi-web-protocol";

/** 服务端已验签、可安全下发浏览器的 manifest(去 signature,标记已预校验)。 */
export type VettedManifest = Omit<WebExtensionManifest, "signature"> & {
  readonly signaturePreVerified: true;
};

export type TrustVerdict =
  | { readonly ok: true; readonly vetted: VettedManifest; readonly unsafeWarning?: string }
  | { readonly ok: false; readonly reason: string };

export interface WebextTrustService {
  verifyManifest(manifest: WebExtensionManifest): Promise<TrustVerdict>;
}

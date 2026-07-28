/**
 * webext-trust-service — 服务端发布者签名校验(webext-package-install 任务 2.2)。
 *
 * 用注册表提供的受信发布者 **Ed25519 公钥** 在服务端验 manifest 签名,通过后产出
 * 可安全下发浏览器的「已背书 manifest」(VettedManifest):去除 signature 字段、标记
 * signaturePreVerified、保留 integrity(供浏览器 SRI)。验签机密不下发浏览器。
 *
 * 约束:
 *   - 生产模式强制签名,免签开关无效(Req 10.2)。
 *   - 纯声明扩展无代码,无需签名(Req 2.x)。
 *   - 免签(dev)模式加载代码扩展时附不安全提示(Req 10.3)。
 */
import {
  isDeclarativeOnly,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";
import { verifyManifestSignature } from "./server-gate.js";
import type { TrustedPublisherRegistry } from "./trusted-publisher-registry.js";

// 契约类型已上提包面(REQ-A10:云宿主同用),此处 re-export 保持调用点零改;实现仍在本文件。
export type {
  VettedManifest,
  TrustVerdict,
  WebextTrustService,
} from "@blksails/pi-web-server/webext-runtime";
import type {
  TrustVerdict,
  VettedManifest,
  WebextTrustService as TrustSvc,
} from "@blksails/pi-web-server/webext-runtime";

export interface TrustServiceConfig {
  readonly registry: TrustedPublisherRegistry;
  /** 是否强制签名(由 env 配置;生产恒被强制为真)。 */
  readonly requireSignature: boolean;
  /** 是否生产环境:生产强制签名、免签开关无效。 */
  readonly isProduction: boolean;
}

function strip(manifest: WebExtensionManifest): VettedManifest {
  const rest: Omit<WebExtensionManifest, "signature"> = { ...manifest };
  delete (rest as { signature?: string }).signature;
  return { ...rest, signaturePreVerified: true };
}

export function createWebextTrustService(
  cfg: TrustServiceConfig,
): TrustSvc {
  // 生产强制签名:免签开关无效(Req 10.2)。
  const enforceSignature = cfg.isProduction || cfg.requireSignature;
  return {
    async verifyManifest(manifest: WebExtensionManifest): Promise<TrustVerdict> {
      // 纯声明扩展:无代码,无需签名。
      if (isDeclarativeOnly(manifest)) {
        return { ok: true, vetted: strip(manifest) };
      }
      // 代码扩展。
      if (!enforceSignature) {
        return {
          ok: true,
          vetted: strip(manifest),
          unsafeWarning:
            "webext 以免签(dev)模式加载;生产环境必须由受信发布者签名,切勿用于生产",
        };
      }
      if (manifest.signature === undefined) {
        return { ok: false, reason: "代码 webext 未签名" };
      }
      const trusted = await verifyManifestSignature(
        manifest,
        cfg.registry.publicKeys(),
      );
      if (!trusted) {
        return {
          ok: false,
          reason: "签名不在受信发布者白名单内或验签失败",
        };
      }
      return { ok: true, vetted: strip(manifest) };
    },
  };
}

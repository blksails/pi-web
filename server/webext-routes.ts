/**
 * webext 端点 —— 处理器主体已上提包面 `@blksails/pi-web-server/webext-runtime`(REQ-A10);
 * 本文件只做**本宿主的依赖注入**(磁盘定位/读取 + 本地 trust 装配)。
 *
 * 安全语义仍在注入的实现里:`readDistFile` 经 realpath 前缀校验防目录穿越,且 dist 目录
 * 必须以 `.pi/web/dist` 结尾(见 `lib/app/webext/locate-dist.ts`);resolve 只下发去签名的
 * 已背书 manifest 与 baseUrl,验签机密不入浏览器。
 *
 * 本模块只导出处理器;路由注册由 `server/index.ts` 统一完成。
 */
import {
  createWebextDistHandler,
  createWebextResolveHandler,
} from "@blksails/pi-web-server/webext-runtime";
import { getWebextTrust } from "../lib/app/webext/build-trust.js";
import {
  decodeDistDir,
  readDistFile,
  locateDist,
  readManifestJson,
  toBaseUrl,
} from "../lib/app/webext/locate-dist.js";

/** GET /api/webext/dist/<base64url(distDir)>/<file...> */
export const handleWebextDist = createWebextDistHandler({ decodeDistDir, readDistFile });

/** GET /api/webext/resolve?source=<source> */
export const handleWebextResolve = createWebextResolveHandler(async () => {
  const { trust } = await getWebextTrust();
  return { locateDist, readManifestJson, toBaseUrl, trust };
});

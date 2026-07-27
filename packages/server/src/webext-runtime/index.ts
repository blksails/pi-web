/**
 * webext 运行时车道(`@blksails/pi-web-server/webext-runtime`)。
 *
 * 把「运行时加载**代码/组件** webext」这一宿主机制上提为泛用包面,使任何 pi-web 宿主
 * (Vite SPA / Next App Router / 自建)都能以同一套语义承载**带 React 组件**的扩展,
 * 而非各自复刻一份。本目录只放**载体无关**件:纯函数、纯类型、标准 `Response`,不碰 fs。
 *
 * 宿主需自备的三件(因载体而异,故不在此):
 *  - `locateDist(source)` / `readManifestJson` / `toBaseUrl`:把源引用映射到其 `.pi/web/dist`
 *    (本机磁盘 / registry bundle / 云沙箱皆可);
 *  - `readDistFile` + `decodeDistDir`:产物字节读取与寻址键编解码(**安全语义归实现方**);
 *  - `trust`:验签实现(受信发布者源因宿主而异);验签机密永不下发浏览器。
 * 另需在入口把 react / react-dom / jsx-runtime / pi-web-kit 实例写入
 * `globalThis[WEBEXT_SINGLETON_GLOBAL]`,并在页面内联 `WEBEXT_IMPORT_MAP`。
 */
export {
  WEBEXT_SINGLETON_GLOBAL,
  WEBEXT_IMPORT_MAP,
  singletonModuleFor,
  handleSingleton,
} from "./singletons.js";

export type { VettedManifest, TrustVerdict, WebextTrustService } from "./trust-contract.js";

export {
  resolveWebext,
  createWebextResolveHandler,
  type WebextResolveResponse,
  type ResolveWebextDeps,
} from "./resolve-webext.js";

export {
  createWebextDistHandler,
  webextContentTypeFor,
  type WebextDistDeps,
} from "./dist-handler.js";

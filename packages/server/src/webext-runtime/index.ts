/**
 * webext 运行时车道(`@blksails/pi-web-server/webext-runtime`)。
 *
 * 把「运行时加载**代码** webext」这一宿主机制上提为泛用包面,使任何 pi-web 宿主
 * (Vite SPA / Next App Router / 自建)都能以同一套语义承载**带 React 组件**的扩展,
 * 而非各自复刻一份。本目录只放**框架无关**件:纯函数 + 标准 `Response`,不碰 fs。
 *
 * 宿主需自备的两件(因载体而异,故不在此):
 *  - `locateDist(source)`:把源引用映射到其 `.pi/web/dist` 目录/字节源
 *    (本机磁盘 / registry bundle / 云沙箱皆可);
 *  - 单例桥注入:入口处把宿主的 react / react-dom / jsx-runtime / pi-web-kit 实例
 *    写入 `globalThis[WEBEXT_SINGLETON_GLOBAL]`,并在页面内联 `WEBEXT_IMPORT_MAP`。
 */
export {
  WEBEXT_SINGLETON_GLOBAL,
  WEBEXT_IMPORT_MAP,
  singletonModuleFor,
  handleSingleton,
} from "./singletons.js";

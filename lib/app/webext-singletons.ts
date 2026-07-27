/**
 * webext 单例 import map 规格 —— 已上提为泛用包面
 * `@blksails/pi-web-server/webext-runtime`(REQ-A10:让 Next/Vite/自建宿主共用同一机制,
 * 不再各自复刻)。本文件保留为**转发层**,宿主内既有引用点(index.html 生成、测试)零改。
 */
export {
  WEBEXT_SINGLETON_GLOBAL,
  WEBEXT_IMPORT_MAP,
} from "@blksails/pi-web-server/webext-runtime";

/**
 * 废弃别名模块:`PiChatPro` / `PiChatProProps`。
 *
 * 富组件已收敛为默认 `PiChat`(见 ./pi-chat.tsx);本文件仅做薄 re-export 以保持
 * 旧引用可用,不含任何实现。
 *
 * @deprecated 使用 `PiChat`(已收敛为默认富组件)。本别名将在下个周期移除。
 */
export { PiChat as PiChatPro, type PiChatProps as PiChatProProps } from "./pi-chat.js";

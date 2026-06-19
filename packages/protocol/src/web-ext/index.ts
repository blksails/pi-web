/**
 * @pi-web/protocol/web-ext — UI 控制层(agent-web-extension)的可序列化契约面。
 *
 * manifest(清单+SRI/签名)/ ui-rpc(Tier3 双向)/ descriptor(SlotKey+声明式 config)/
 * artifact(Tier4 postMessage)。均纯数据+zod,不依赖 React。运行时携带组件的描述符在
 * `@pi-web/web-kit`。
 */
export * from "./manifest.js";
export * from "./ui-rpc.js";
export * from "./descriptor.js";
export * from "./artifact.js";

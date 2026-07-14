/**
 * frame-channel · globalThis seam key 常量(单一权威)。
 *
 * 这些 key 用于把 runner 子进程装配的 provider/上下文透给运行在同一子进程、经 jiti 装载的
 * 作者工具(装载期闭包不可达,故用 globalThis seam)。原先散落在三个 wiring 文件里各自定义,
 * 现集中于此单一来源(Req 7.2)。
 *
 * ⚠ 每个 key **必须**与 `@blksails/pi-web-tool-kit` 侧的对应常量保持一致:
 *  - `SESSION_STATE_SEAM_KEY`   ↔ tool-kit `SESSION_STATE_SEAM_KEY`(`getSessionState()`)
 *  - `SURFACE_REGISTRY_SEAM_KEY`↔ tool-kit `SURFACE_REGISTRY_SEAM_KEY`(`createSurface`)
 *  - `ATTACHMENT_TOOL_CONTEXT_KEY` ↔ 示例工具端 `ATTACHMENT_CTX_KEY`
 * 为免 server → tool-kit 反向依赖,此处按既有先例 duplicate + 一致性注释。
 */

/** 会话状态注入桥 seam key。 */
export const SESSION_STATE_SEAM_KEY = "__piWebSessionState__";

/** surface 注册表 seam key。 */
export const SURFACE_REGISTRY_SEAM_KEY = "__piWebSurfaces__";

/** attachment 工具接入上下文 seam key。 */
export const ATTACHMENT_TOOL_CONTEXT_KEY = "__piWebAttachmentToolContext__";

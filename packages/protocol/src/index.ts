/**
 * @blksails/pi-web-protocol — 聚合导出面(下游唯一导入面)。
 *
 * 从 version、rpc/*、transport/* re-export 全部 schema、由 z.infer 推导的类型与
 * protocolVersion。pi 原生派生(rpc/*)与 pi-web 自定义传输层(transport/*)分文件,
 * 来源可辨识、可分别演进。禁止 rpc/transport 反向导入本入口。
 */

// 版本常量
export { protocolVersion, type ProtocolVersion } from "./version.js";

// rpc 层(pi 原生派生,对齐 pi 0.79.x)
export * from "./rpc/model.js";
export * from "./rpc/command.js";
export * from "./rpc/response.js";
export * from "./rpc/event.js";
export * from "./rpc/extension-ui.js";
export * from "./rpc/session-state.js";

// transport 层(pi-web 自定义)
export * from "./transport/spawn.js";
export * from "./transport/ui-spec.js";
export * from "./transport/data-part.js";
export * from "./transport/part-kinds.js";
export * from "./transport/ui-message-chunk.js";
export * from "./transport/session-status.js";
export * from "./transport/session-state.js";
export * from "./transport/sse-frame.js";
export * from "./transport/rest-dto.js";
export * from "./transport/completion-dto.js";
export * from "./transport/slash-completion.js";

// agent-routes 层(agent 声明式 HTTP routes:声明 DTO + 三个自建 JSONL 帧)
export * from "./agent-routes/frames.js";

// attachment 层(attachment-store 描述符 + 上传响应 DTO)
export * from "./attachment/attachment-dto.js";
// agent 具名附件 profile 装配期声明帧(agent-attachment-profile spec)
export * from "./attachment/profile-frame.js";
// agent 附件目录:四种帧 + control 载荷(agent-attachment-catalog spec)
export * from "./attachment/catalog.js";

// config 层(由 object schema 生成配置 UI 的契约:表单 IR + adapter + 配置域)
export * from "./config/index.js";

// web-ext 层(agent-web-extension UI 控制层契约:manifest / ui-rpc / descriptor / artifact)
export * from "./web-ext/index.js";

// plugin 层(统一包清单契约:pi-web.json — pi 资源 + webext 两层入口,kind 判别 agent/plugin)
export * from "./plugin/index.js";

// logging 层(日志数据契约:LogLevelSchema / LogEntrySchema / parseLogLine)
export * from "./logging/index.js";

// privacy 层(展示脱敏纯函数:路径显示模式 off/home/basename)
export {
  type PathDisplayMode,
  DEFAULT_PATH_DISPLAY_MODE,
  parsePathDisplayMode,
  maskPaths,
  maskPathsDeep,
  maskHomePaths,
  maskHomePathsDeep,
} from "./privacy/mask-home-paths.js";

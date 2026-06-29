/**
 * piweb-entries — pi-web 写入会话存储的自定义条目(`type:"custom"`)类型标识与形状。
 *
 * 这些常量同时被 runner(写入)与主进程读取器(surfacing / 冷恢复)共享,集中于此避免字面量漂移。
 * 本模块无 pi SDK 值导入,可安全经 session-store barrel → 包主 barrel 重导出。
 */

/**
 * 纯扩展命令调用标记(spec plugin-system-unification R13)。runner 在纯命令(handler 跑完
 * 不留 message、不进 streaming)后写入,载 `{ text }`(原始命令文本);服务端 `GET /messages`
 * 读取并按时间序合并 surfacing,使纯命令冷恢复仍在转录区可见。LLM-clean(session 文件条目,
 * 不入 `session.messages` / `convertToLlm`)。
 */
export const PIWEB_COMMAND_CUSTOM_TYPE = "piweb.command";

/** `piweb.command` 自定义条目所载数据形状。 */
export interface PiwebCommandMarkerData {
  /** 用户提交的原始命令文本(含前导 `/`,如 `/review`)。 */
  readonly text: string;
}

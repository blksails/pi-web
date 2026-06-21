/**
 * attachment-tool-bridge · 子进程 store 客户端工厂 `createChildAttachmentStore`
 * (task 1.1;Req 3.1, 3.2, 3.3, 3.4)。
 *
 * runner 子进程内按 spawn env 实例化一个**指向与主进程同一后端**的 store 客户端,使运行在
 * 子进程的 tool `execute` 能解析/落库附件,而无需回调主进程(Req 3.1/3.3)。
 *
 * 设计约束(design.md §createChildAttachmentStore / §Allowed Dependencies):
 * - **严格复用上游门面**:子进程侧 store 客户端 **即** 上游 {@link AttachmentStore} 门面本身,
 *   不自定义重名访问器、不内联 `{mimeType,size}` meta、不抠 `LocalFsBlobBackend` 内部。
 *   所有访问经门面 `head`/`getReadStream(meta=BlobMeta)`/`localPath(id)`/`listBySession(sessionId)`/
 *   `put(origin:"tool-output")`/`presignUrl` 调用(Req 3.1/3.2)。
 * - **同后端 + 同 secret**:经 spawn env 下发的 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`
 *   (二者均由 `attachment-store` 全权下发,本切片仅消费),组合上游受认可复用面
 *   {@link attachmentStoreConfigFromEnv} 实例化门面,使子进程指向同一目录、签名 secret 一致 →
 *   子进程产出的 `/raw` 签名 URL 能在主进程通过验证(Req 3.2)。
 * - **env 缺失降级**:当**存储目录约定**(`PI_WEB_ATTACHMENT_DIR`)未经 spawn env 下发(缺省或空)时,
 *   返回 `undefined`(能力不可用),由 tool 据此报「附件能力不可用」,而非以未定义行为崩溃子进程(Req 3.4)。
 *   注意:上游 `attachmentStoreConfigFromEnv` 在缺 DIR 时会回落到约定默认目录(主进程语义);子进程侧
 *   则把「未经 spawn env 下发存储目录」视为「未配置附件存储」→ 不可用,故在本工厂显式前置判定 DIR 存在。
 */
import type { AttachmentStore } from "../attachment/attachment-store.js";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
} from "../attachment/config.js";

/**
 * 子进程侧 store 客户端类型 **=== 上游 {@link AttachmentStore} 门面别名**。
 *
 * 不自定义重名访问器/不内联 meta:复用上游门面契约
 * (`head` / `getReadStream`(meta=`BlobMeta`)/ `localPath(id)` / `listBySession(sessionId)` /
 * `put`(origin `"tool-output"`)/ `presignUrl`),全部经门面调用。
 */
export type ChildAttachmentStore = AttachmentStore;

/**
 * 从 env 构造子进程侧 store 客户端(上游 {@link AttachmentStore} 门面)。
 *
 * 读取 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`(均由 `attachment-store` 经 spawn env
 * 下发),经 {@link attachmentStoreConfigFromEnv} 组合上游受认可复用面实例化上游门面。
 *
 * @param env 环境变量来源(通常为子进程 `process.env`)。
 * @returns 当**存储目录约定**(`PI_WEB_ATTACHMENT_DIR`)已下发 → 可用的上游门面客户端;
 *          缺省(未设或空)→ `undefined`(附件能力不可用,Req 3.4)。
 */
export function createChildAttachmentStore(
  env: NodeJS.ProcessEnv,
): ChildAttachmentStore | undefined {
  // 存储目录约定缺失(未经 spawn env 下发)→ 视为未配置附件存储,能力不可用(Req 3.4)。
  // 不回落上游默认目录:子进程侧「未下发」即「不可用」,避免静默指向一个非共享的默认目录。
  const dir = env[ATTACHMENT_DIR_ENV];
  if (dir === undefined || dir.length === 0) return undefined;

  // 经上游受认可复用面构造门面(指向同一目录 + 同一 secret)。
  const { store } = attachmentStoreConfigFromEnv(env);
  return store;
}

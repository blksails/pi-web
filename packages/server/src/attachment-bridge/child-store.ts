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
 * - **env 缺失降级**:当**存储目录约定**(`PI_WEB_ATTACHMENT_DIR`)与**多后端拓扑约定**
 *   (`PI_WEB_ATTACHMENT_BACKENDS`)均未经 spawn env 下发(缺省或空)时,返回 `undefined`
 *   (能力不可用),由 tool 据此报「附件能力不可用」,而非以未定义行为崩溃子进程(Req 3.4/6.3)。
 *   注意:上游 `attachmentStoreConfigFromEnv` 在缺 DIR 时会回落到约定默认目录(主进程语义);子进程侧
 *   则把「二者均未经 spawn env 下发」视为「未配置附件存储」→ 不可用,故在本工厂显式前置判定
 *   `attachment-backend-pluggable` spec 扩展门控:DIR 或 BACKENDS 任一下发即视为已配置(Req 6.2/6.3)。
 */
import type { AttachmentStore } from "../attachment/attachment-store.js";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
} from "../attachment/config.js";
import { ATTACHMENT_BACKENDS_ENV } from "../attachment/backends-config.js";

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
 * @param opts 可选:`writeProfile`(`agent-attachment-profile` spec,Req 3.2)——子进程一会话
 *   一进程,由 runner 装配期按白名单校验通过的 agent 声明**静态**绑定,原样透传给
 *   {@link attachmentStoreConfigFromEnv} 覆盖多后端拓扑的写路由。未传 = 现状(宿主默认写路由,
 *   零行为变化)。
 * @returns 当**存储目录约定**(`PI_WEB_ATTACHMENT_DIR`)或**多后端拓扑约定**
 *          (`PI_WEB_ATTACHMENT_BACKENDS`)任一已下发 → 可用的上游门面客户端(Req 6.2);
 *          二者均缺省(未设或空)→ `undefined`(附件能力不可用,Req 3.4/6.3)。
 */
export function createChildAttachmentStore(
  env: NodeJS.ProcessEnv,
  opts?: { readonly writeProfile?: string },
): ChildAttachmentStore | undefined {
  // 门控扩为「附件目录或拓扑 env 任一下发即可用」(attachment-backend-pluggable spec,Req 6.2):
  // 多后端拓扑生效时,子进程可能仅下发 BACKENDS(不依赖单一目录约定)即可重建同构 union。
  // 不回落上游默认目录:子进程侧「均未下发」即「不可用」,避免静默指向一个非共享的默认目录。
  const dir = env[ATTACHMENT_DIR_ENV];
  const backends = env[ATTACHMENT_BACKENDS_ENV];
  const hasDir = dir !== undefined && dir.length > 0;
  const hasBackends = backends !== undefined && backends.length > 0;
  if (!hasDir && !hasBackends) return undefined;

  // 经上游受认可复用面构造门面(指向同一目录/拓扑 + 同一 secret);writeProfile 原样透传
  // (agent-attachment-profile spec)。
  const { store } = attachmentStoreConfigFromEnv(env, {
    writeProfile: opts?.writeProfile,
  });
  return store;
}

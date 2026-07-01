/**
 * pi-web 自定义传输层 — REST DTO schema(建会话 + 各命令请求/响应)。
 *
 * 对应 PLAN.md §3.3 / §13.2 的 REST 面。本包仅定义 DTO 形状;端点实现归 http-api。
 *
 *   POST /sessions                         CreateSessionRequest → { sessionId }
 *   POST /sessions/:id/messages            PromptRequest        → CommandAck
 *   POST /sessions/:id/{steer,follow_up}   SteerRequest         → CommandAck
 *   POST /sessions/:id/abort               —                    → CommandAck
 *   POST /sessions/:id/model               SetModelRequest      → CommandAck
 *   POST /sessions/:id/thinking            SetThinkingRequest   → CommandAck
 *   GET  /sessions/:id/state               —                    → GetStateResponse
 *   GET  /sessions/:id/stats               —                    → GetStatsResponse
 *   GET  /sessions/:id/messages            —                    → GetMessagesResponse
 *   GET  /sessions/:id/commands            —                    → GetCommandsResponse
 *   POST /sessions/:id/ui-response         ExtensionUIResponse  → CommandAck
 *   DELETE /sessions/:id                   —                    → CommandAck
 *   GET  /sessions/:id/models              —                    → GetAvailableModelsResponse
 *   POST /sessions/:id/fork                ForkRequest          → ForkResponse
 *   GET  /sessions/:id/fork-messages       —                    → GetForkMessagesResponse
 */
import { z } from "zod";
import { ImageContentSchema, ModelSchema, ThinkingLevelSchema } from "../rpc/model.js";
import {
  RpcSessionStateSchema,
  RpcSlashCommandSchema,
  SessionStatsSchema,
} from "../rpc/session-state.js";
import { AgentMessageSchema } from "../rpc/model.js";
import { RpcExtensionUIResponseSchema } from "../rpc/extension-ui.js";
import { LogEntrySchema, LogLevelSchema } from "../logging/log-entry.js";

/**
 * 建会话请求:`{ source, cwd?, model?, env?, resumeId? }`。`source` 必填(agent 源标识)。
 * `resumeId` 存在即"恢复已有会话"而非新建——服务端据其从持久化存储读取创建元数据
 * (source/cwd/model)并以该标识恢复会话;缺失即新建。
 * 注意:与 SpawnSpec(四字段必填的启动规格)是不同契约,见 transport/spawn.ts。
 */
export const CreateSessionRequestSchema = z.object({
  source: z.string(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  resumeId: z.string().optional(),
  /**
   * 按请求的显式项目信任意图(门控工作目录下 `.pi/` 扩展/子代理/技能的加载)。
   * `true` → 信任并放行(并跨会话记住);`false` → 拒绝;缺省 → 由服务端信任策略
   * (持久化信任库 / trustedRoots / 安全默认)决定。
   */
  trust: z.boolean().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
});
export type CreateSessionResponse = z.infer<
  typeof CreateSessionResponseSchema
>;

/** 通用命令 ack 响应。 */
export const CommandAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type CommandAck = z.infer<typeof CommandAckSchema>;

export const PromptRequestSchema = z.object({
  message: z.string(),
  images: z.array(ImageContentSchema).optional(),
  streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  /**
   * 该消息附带的已落库附件的公开 id 列表(`att_<nanoid>`),由前端提交。
   * 服务端据此查元数据并以结构化文本引用注入用户消息文本(attachment-tool-bridge,
   * Req 8.1);与 `images`/vision base64 并存,不替代、不内联字节(Req 9.1)。
   */
  attachmentIds: z.array(z.string()).optional(),
});
export type PromptRequest = z.infer<typeof PromptRequestSchema>;

export const SteerRequestSchema = z.object({
  message: z.string(),
  images: z.array(ImageContentSchema).optional(),
});
export type SteerRequest = z.infer<typeof SteerRequestSchema>;

export const SetModelRequestSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
});
export type SetModelRequest = z.infer<typeof SetModelRequestSchema>;

export const SetThinkingRequestSchema = z.object({
  level: ThinkingLevelSchema,
});
export type SetThinkingRequest = z.infer<typeof SetThinkingRequestSchema>;

export const GetStateResponseSchema = z.object({
  state: RpcSessionStateSchema,
});
export type GetStateResponse = z.infer<typeof GetStateResponseSchema>;

export const GetStatsResponseSchema = z.object({
  stats: SessionStatsSchema,
});
export type GetStatsResponse = z.infer<typeof GetStatsResponseSchema>;

export const GetMessagesResponseSchema = z.object({
  messages: z.array(AgentMessageSchema),
});
export type GetMessagesResponse = z.infer<typeof GetMessagesResponseSchema>;

export const GetCommandsResponseSchema = z.object({
  commands: z.array(RpcSlashCommandSchema),
});
export type GetCommandsResponse = z.infer<typeof GetCommandsResponseSchema>;

/** ui-response 请求体即 pi 的 RpcExtensionUIResponse。 */
export const UiResponseRequestSchema = RpcExtensionUIResponseSchema;
export type UiResponseRequest = z.infer<typeof UiResponseRequestSchema>;

/**
 * GET /sessions/:id/models 响应 —— 复用既有 `Model` schema。
 * 对齐 RpcCommand `get_available_models` 的成功响应 `{ models: Model[] }`(见 rpc/response.ts)。
 * 模型列表仅来自 pi,不含写死项;空列表合法(对应"模型选择器降级"语义,见 Requirement 4.4/4.5)。
 */
export const GetAvailableModelsResponseSchema = z.object({
  models: z.array(ModelSchema),
});
export type GetAvailableModelsResponse = z.infer<
  typeof GetAvailableModelsResponseSchema
>;

/**
 * POST /sessions/:id/fork 请求 —— 复用既有 entryId 形状。
 * 对齐 RpcCommand `fork`(`{ type: "fork", entryId }`)。
 */
export const ForkRequestSchema = z.object({
  entryId: z.string(),
});
export type ForkRequest = z.infer<typeof ForkRequestSchema>;

/**
 * POST /sessions/:id/fork 响应。
 * 对齐 RpcCommand `fork` 的成功响应 `{ text, cancelled }`(见 rpc/response.ts);
 * 两字段在 REST 透传面均为可选(取消时可仅返回 `cancelled`)。
 */
export const ForkResponseSchema = z.object({
  text: z.string().optional(),
  cancelled: z.boolean().optional(),
});
export type ForkResponse = z.infer<typeof ForkResponseSchema>;

/**
 * GET /sessions/:id/fork-messages 响应。
 * 对齐 RpcCommand `get_fork_messages` 的成功响应 `{ messages: { entryId, text }[] }`
 * (见 rpc/response.ts)。
 */
export const GetForkMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({ entryId: z.string(), text: z.string() }),
  ),
});
export type GetForkMessagesResponse = z.infer<
  typeof GetForkMessagesResponseSchema
>;

/**
 * GET /sessions 列表端点 —— 请求/响应/列表项契约(sessions-list)。
 *
 *   GET /sessions?scope=cwd|all&cwd=&limit=&cursor=  → ListSessionsResponse
 *
 * 仅基于会话头部轻量元数据(不读正文)。`scope=all`(系统/全机器视图)受部署门控,
 * 默认关闭;关闭时端点拒绝该 scope。分页用不透明游标 `cursor`,按
 * `updatedAt ?? createdAt` 倒序的 keyset 续取,保证不重复已返回会话。
 */
export const ListSessionsRequestSchema = z.object({
  /** 视图范围:`cwd`(当前目录,默认)| `all`(系统全机器,受门控)。 */
  scope: z.enum(["cwd", "all"]).optional(),
  /** `scope=cwd` 的目标工作目录;缺省由服务端取默认 cwd。 */
  cwd: z.string().optional(),
  /**
   * `scope=cwd` 时以该会话的持久化 cwd 作为目标目录(优先于 `cwd` 参数),用于
   * 「当前会话所在目录」——前端无法可靠推断 agent 解析后的真实 cwd,故交由服务端
   * 从会话头部解析;会话不存在时回退到 `cwd`/默认 cwd。
   */
  sessionId: z.string().optional(),
  /** 单页上限;缺省由服务端取默认值并 clamp 到上限。 */
  limit: z.number().int().positive().optional(),
  /** 续取游标(不透明);缺省取首页。 */
  cursor: z.string().optional(),
  /**
   * 名称搜索关键字(sidebar-launcher-rail):非空时按会话名称/标识子串(大小写不敏感)
   * 过滤;缺省/空串行为与不过滤一致(向后兼容)。限长防 DOS。仅匹配名称,不检索正文。
   */
  q: z.string().max(100).optional(),
});
export type ListSessionsRequest = z.infer<typeof ListSessionsRequestSchema>;

/** 列表项 —— 会话头部轻量元数据投影(无正文/无消息数)。 */
export const SessionListItemSchema = z.object({
  sessionId: z.string(),
  name: z.string().optional(),
  cwd: z.string(),
  /** ISO 创建时间(来自 header.timestamp)。 */
  createdAt: z.string(),
  /** ISO 最近更新时间(可得则填;部分存储后端无此值)。 */
  updatedAt: z.string().optional(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionListItemSchema),
  /** 缺省表示无更多页。 */
  nextCursor: z.string().optional(),
  /** 回显生效的视图范围。 */
  scope: z.enum(["cwd", "all"]),
  /** 系统(全机器)视图是否启用,供前端确认入口可用性。 */
  globalEnabled: z.boolean(),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

/**
 * GET /agent-sources 列表端点 —— 请求/响应/列表项契约(agent-sources-list)。
 *
 *   GET /agent-sources?limit=&cursor=  → ListAgentSourcesResponse
 *
 * 只读枚举「当前环境可用的 agent source」,数据来源为「目录扫描 ∪ 注册表文件」两路合并、
 * 按 id 去重(registry 覆盖 scan)。端点严格只读:不写、不 clone git、不 resolve/spawn。
 * 分页用不透明 keyset 游标 `cursor`(base64url `{origin,name,id}`,与列表排序同序),即便游标
 * 记录在两次请求间消失也不重发/漏发已返回条目。
 */
export const AgentSourceItemSchema = z.object({
  /** 稳定标识:dir→realpath 绝对路径;git→`url@ref`。 */
  id: z.string(),
  /** 可直接提交给会话创建链路(等价手输)的 source 字符串。 */
  source: z.string(),
  /** 显示名:registry.name > package.json name > 目录/repo 末段。 */
  name: z.string(),
  /** 源类型。 */
  kind: z.enum(["dir", "git"]),
  /** 来源渠道:目录扫描 | 注册表登记。 */
  origin: z.enum(["scan", "registry"]),
  /** 解析模式:含入口文件→custom;否则→cli(与真正建会话判定一致)。 */
  mode: z.enum(["custom", "cli"]),
  /**
   * 可选展示标题(比 `name` 更友好的人读名):`pi-web.title` / registry.title;
   * 列表展示优先用 `title ?? name`。
   */
  title: z.string().optional(),
  /** 可选描述(pi-web.description / registry.description / package.json description)。 */
  description: z.string().optional(),
  /**
   * 可选头像:图片 URL(http/https/data:)直接渲染为图片;否则按短文本/emoji 渲染;
   * 缺省时前端用标题/名称首字母兜底。来源:`pi-web.avatar` / registry.avatar。
   */
  avatar: z.string().optional(),
});
export type AgentSourceItem = z.infer<typeof AgentSourceItemSchema>;

export const ListAgentSourcesRequestSchema = z.object({
  /** 单页上限;缺省由服务端取默认值并 clamp 到上限。 */
  limit: z.number().int().positive().optional(),
  /** 续取游标(不透明);缺省取首页。 */
  cursor: z.string().optional(),
});
export type ListAgentSourcesRequest = z.infer<
  typeof ListAgentSourcesRequestSchema
>;

export const ListAgentSourcesResponseSchema = z.object({
  sources: z.array(AgentSourceItemSchema),
  /** 缺省表示无更多页。 */
  nextCursor: z.string().optional(),
});
export type ListAgentSourcesResponse = z.infer<
  typeof ListAgentSourcesResponseSchema
>;

/**
 * agent source 收藏(sidebar-launcher-rail)—— 用户偏好,独立于只读源枚举。
 *
 *   GET /agent-sources/favorites            → ListFavoritesResponse
 *   PUT /agent-sources/favorites  { favorites } → ListFavoritesResponse(回显)
 *
 * 持久化在 `<agentDir>/agent-source-favorites.json`。PUT 为全量替换(幂等)。收藏/取消
 * 收藏不修改源枚举的来源(扫描目录/注册表文件)。
 */
export const AgentSourceFavoriteSchema = z.object({
  /** 提交给会话创建链路的 source 字符串(等价手输/列表选取)。 */
  source: z.string(),
  /** 技术名(兜底标签)。 */
  name: z.string(),
  /** 可选展示标题;锚点优先显示 title ?? name。 */
  title: z.string().optional(),
  /** 可选头像(图片 URL/data-URI 或短文本/emoji)。 */
  avatar: z.string().optional(),
});
export type AgentSourceFavorite = z.infer<typeof AgentSourceFavoriteSchema>;

export const ListFavoritesResponseSchema = z.object({
  favorites: z.array(AgentSourceFavoriteSchema),
});
export type ListFavoritesResponse = z.infer<typeof ListFavoritesResponseSchema>;

export const SetFavoritesRequestSchema = z.object({
  /** 全量替换的收藏集合。 */
  favorites: z.array(AgentSourceFavoriteSchema),
});
export type SetFavoritesRequest = z.infer<typeof SetFavoritesRequestSchema>;

/**
 * 会话操作端点 —— 删除 / 重命名 / 会话收藏(session-list-item-actions)。
 *
 *   POST /sessions/delete    { sessionId }        → CommandAck                    (幂等物理删除)
 *   POST /sessions/rename    { sessionId, name }  → RenameSessionResponse
 *   GET  /sessions/favorites                      → ListSessionFavoritesResponse
 *   POST /sessions/favorites { sessionIds }       → ListSessionFavoritesResponse  (全量替换回显)
 *
 * 全部**无 `:id` 路径参数**(sessionId 走请求体),绕过 router 对内存会话的存在性门控,
 * 故可作用于历史(非运行)会话。写操作受部署门控 `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE`。
 */

/** 会话显示名最大长度(防滥用/DOS);超限由端点返回校验错误。 */
export const SESSION_NAME_MAX_LENGTH = 200;

export const DeleteSessionRequestSchema = z.object({
  /** 待物理删除的会话标识。 */
  sessionId: z.string().min(1),
});
export type DeleteSessionRequest = z.infer<typeof DeleteSessionRequestSchema>;

export const RenameSessionRequestSchema = z.object({
  /** 待重命名的会话标识。 */
  sessionId: z.string().min(1),
  /** 新显示名:trim 后非空、原串不超过上限;服务端以 trim 结果落库。 */
  name: z
    .string()
    .max(SESSION_NAME_MAX_LENGTH)
    .refine((s) => s.trim().length > 0, {
      message: "name must not be blank",
    }),
});
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>;

export const RenameSessionResponseSchema = z.object({
  sessionId: z.string(),
  /** 落库后的最新显示名(已 trim)。 */
  name: z.string(),
});
export type RenameSessionResponse = z.infer<typeof RenameSessionResponseSchema>;

export const ListSessionFavoritesResponseSchema = z.object({
  /** 已收藏的会话标识集合(去重、无空串)。 */
  sessionIds: z.array(z.string()),
});
export type ListSessionFavoritesResponse = z.infer<
  typeof ListSessionFavoritesResponseSchema
>;

export const SetSessionFavoritesRequestSchema = z.object({
  /** 全量替换的收藏会话标识集合;服务端落库前去重、丢空串。 */
  sessionIds: z.array(z.string()),
});
export type SetSessionFavoritesRequest = z.infer<
  typeof SetSessionFavoritesRequestSchema
>;

/**
 * GET /sessions/:id/logs 响应 —— 返回结构化日志条目列表。
 * 对应 Requirement 3.3 / design Event Contract: control:logs。
 */
export const GetLogsResponseSchema = z.object({
  entries: z.array(LogEntrySchema),
});
export type GetLogsResponse = z.infer<typeof GetLogsResponseSchema>;

/**
 * GET /sessions/:id/logs 查询参数 schema。
 * 所有字段可选:level 过滤级别、limit 最大条数、since 起始 epoch ms。
 * 对应 Requirement 4.1 (REST 日志端点查询参数)。
 */
export const GetLogsQuerySchema = z.object({
  level: LogLevelSchema.optional(),
  limit: z.number().optional(),
  since: z.number().optional(),
});
export type GetLogsQuery = z.infer<typeof GetLogsQuerySchema>;

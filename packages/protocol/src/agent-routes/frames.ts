/**
 * pi-web agent-routes 层 — agent 声明式 HTTP routes 的进程边界契约
 * (spec agent-declared-routes)。
 *
 * 三类自建 JSONL 帧(与 `slash_completions` 同族,均为 pi-web 自建帧,
 * 不触及外部 pi SDK,也不进入 SSE 帧 union):
 *  - `AgentRoutesFrame`:agent 子进程在 **runner 装配期**(`runRpcMode` 之前)经 stdout
 *    单次推给 server 主进程的声明帧,携带纯数据声明投影(handler 函数不过进程边界)。
 *    server 端 `PiSession.handleRawLine` 识别后按会话缓存为路由表。
 *  - `AgentRouteRequestFrame`:主进程→子进程的请求帧(stdin 行),携带一次 route 调用
 *    的请求上下文;`id` 由主进程生成,用于与结果帧同步配对。
 *  - `AgentRouteResultFrame`:子进程→主进程的结果帧(fd1 直写行),按 `id` 回配
 *    pending 请求,`ok` 判别成功(result)/失败(error)两个分支。
 */
import { z } from "zod";

/** route 允许的 HTTP 方法白名单(GET/POST)。 */
export const AgentRouteMethodSchema = z.enum(["GET", "POST"]);
export type AgentRouteMethod = z.infer<typeof AgentRouteMethodSchema>;

/**
 * 单个 route 的纯数据声明投影(handler 函数不过进程边界)。
 * schema 层 name 只要求非空;格式(`^[a-z0-9][a-z0-9-]*$`)与同定义内唯一性的
 * 权威校验在装配层(agent-loader 归一化)完成。
 */
export const AgentRouteDeclDtoSchema = z.object({
  /** route 名称(会话命名空间下的 URL 段),如 "canvas-snapshot"。 */
  name: z.string().min(1),
  /** 允许的 HTTP 方法集合(GET/POST 白名单)。 */
  methods: z.array(AgentRouteMethodSchema),
  /** route 描述(清单端点回显,供集成方阅读)。 */
  description: z.string().optional(),
});
export type AgentRouteDeclDto = z.infer<typeof AgentRouteDeclDtoSchema>;

/** 装配期 agent→server 一次性声明帧:声明本会话可调的 routes。 */
export const AgentRoutesFrameSchema = z.object({
  type: z.literal("agent_routes"),
  routes: z.array(AgentRouteDeclDtoSchema),
});
export type AgentRoutesFrame = z.infer<typeof AgentRoutesFrameSchema>;

/** 主进程→子进程 请求帧(stdin 行):一次 route 调用的请求上下文。 */
export const AgentRouteRequestFrameSchema = z.object({
  type: z.literal("piweb_agent_route_request"),
  /** 配对 id(主进程生成,会话内唯一),结果帧按此回配。 */
  id: z.string().min(1),
  /** 目标 route 名称。 */
  name: z.string().min(1),
  /** 本次调用的 HTTP 方法(已过主进程 405 前置检查)。 */
  method: AgentRouteMethodSchema,
  /** URL 查询参数(string→string 平面表)。 */
  query: z.record(z.string()),
  /** 已 JSON.parse 的请求体(GET 无;顶层 HTTP 出口负责序列化边界)。 */
  body: z.unknown().optional(),
});
export type AgentRouteRequestFrame = z.infer<typeof AgentRouteRequestFrameSchema>;

/** 子进程→主进程 结果帧(fd1 直写行):按 `id` 回配 pending 请求。 */
export const AgentRouteResultFrameSchema = z.object({
  type: z.literal("piweb_agent_route_result"),
  /** 与请求帧配对的 id。 */
  id: z.string().min(1),
  /** 成功/失败判别(true→result;false→error)。 */
  ok: z.boolean(),
  /** ok=true:handler 返回的 JSON 值(序列化边界在 HTTP 出口)。 */
  result: z.unknown().optional(),
  /** ok=false:归一化错误(code 如 "handler_error"/"route_not_registered")。 */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type AgentRouteResultFrame = z.infer<typeof AgentRouteResultFrameSchema>;

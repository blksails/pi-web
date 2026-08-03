import { z } from "zod";
// 纯常量住在零依赖模块里(见该文件的说明):本模块顶层的 z.object(...) 是打包器眼里的副作用
// 表达式,不敢 tree-shake —— 常量若留在这里,guest 只为取一个版本号就会内联整个 zod。
// 此处 re-export 保持既有导入点零破坏。
import { PANE_PROTOCOL_VERSION, UNLIMITED_PANE_COUNT } from "./protocol-version.js";

export { PANE_PROTOCOL_VERSION, UNLIMITED_PANE_COUNT };

const NonEmptyIdSchema = z.string().min(1).max(128);

export const PaneRouteGrantSchema = z.object({
  name: NonEmptyIdSchema,
  methods: z.array(z.enum(["GET", "POST"])).min(1),
  maxRequestBytes: z.number().int().positive().max(16 * 1024 * 1024).optional(),
  maxResponseBytes: z.number().int().positive().max(32 * 1024 * 1024).optional(),
});
export type PaneRouteGrant = z.infer<typeof PaneRouteGrantSchema>;

export const PaneSurfaceCommandGrantSchema = z.object({
  domain: NonEmptyIdSchema,
  actions: z.array(NonEmptyIdSchema).min(1),
});
export type PaneSurfaceCommandGrant = z.infer<typeof PaneSurfaceCommandGrantSchema>;

export const PaneCapabilitiesSchema = z.object({
  routes: z.array(PaneRouteGrantSchema).default([]),
  surfaceKeys: z.array(NonEmptyIdSchema).default([]),
  surfaceCommands: z.array(PaneSurfaceCommandGrantSchema).default([]),
  events: z.object({
    publish: z.array(NonEmptyIdSchema).default([]),
    subscribe: z.array(NonEmptyIdSchema).default([]),
  }).default({}),
  attachments: z.enum(["none", "read", "read-write"]).default("none"),
  conversation: z.enum(["none", "submit"]).default("none"),
  downloads: z.boolean().default(false),
  /**
   * 会话级共享状态的逐键授权(spec panes-only-right-panel Req 2)。
   *
   * ★ **读与写分成两张表**,而不是一张表加一个布尔。写是显著更强的权力(它改的是 agent 也在
   * 读的同一份状态),不该被读授权顺带捎上 —— 「订阅这个键」和「能改这个键」是两个决定。
   *
   * 与 `surfaceKeys` 的关系:`surfaceKeys` 搬运的是 **agent 权威快照**(只读、由 agent 发布);
   * 这里搬运的是**会话级共享 KV**(人与 agent 双向读写)。两者事实源不同,故不合并。
   */
  state: z.object({
    read: z.array(NonEmptyIdSchema).default([]),
    write: z.array(NonEmptyIdSchema).default([]),
  }).default({}),
});
export type PaneCapabilities = z.infer<typeof PaneCapabilitiesSchema>;

export const PaneDocumentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), srcDoc: z.string() }),
  z.object({ kind: z.literal("html"), src: z.string().min(1) }),
]);
export type PaneDocument = z.infer<typeof PaneDocumentSchema>;

export const PaneDefinitionSchema = z.object({
  id: NonEmptyIdSchema,
  title: z.string().min(1).max(160),
  icon: z.string().max(32).optional(),
  /** 宿主原生视图标识；声明后由 PanesHost 渲染宿主节点，不启动 Guest iframe。 */
  hostView: NonEmptyIdSchema.optional(),
  document: PaneDocumentSchema,
  capabilities: PaneCapabilitiesSchema,
  allowMultiple: z.boolean().default(false),
  maxInstances: z.number().int().min(1).max(UNLIMITED_PANE_COUNT).default(1),
  lifecycle: z.object({
    keepAlive: z.boolean().default(true),
    suspendWhenHidden: z.boolean().default(false),
  }).default({}),
});
export type PaneDefinition = z.infer<typeof PaneDefinitionSchema>;
export type PaneDefinitionInput = z.input<typeof PaneDefinitionSchema>;

export const PanesDefinitionSchema = z.object({
  id: NonEmptyIdSchema,
  panes: z.array(PaneDefinitionSchema).min(1),
  initialPaneIds: z.array(NonEmptyIdSchema).min(1).optional(),
  maxOpenPanes: z.number().int().min(1).max(UNLIMITED_PANE_COUNT).default(16),
});
export type PanesDefinition = z.infer<typeof PanesDefinitionSchema>;
export type PanesDefinitionInput = z.input<typeof PanesDefinitionSchema>;

export type PaneInstanceState = "creating" | "connecting" | "ready" | "hidden" | "failed" | "disposed";

export interface PaneInstance {
  readonly instanceId: string;
  readonly paneId: string;
  readonly epoch: number;
  readonly state: PaneInstanceState;
}

const RequestBaseSchema = z.object({
  type: z.literal("pane:request"),
  requestId: NonEmptyIdSchema,
});

export const PaneGuestRequestSchema = z.discriminatedUnion("operation", [
  RequestBaseSchema.extend({
    operation: z.literal("route.query"),
    route: NonEmptyIdSchema,
    query: z.record(z.string(), z.string()).optional(),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("route.mutate"),
    route: NonEmptyIdSchema,
    body: z.unknown(),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("surface.run"),
    domain: NonEmptyIdSchema,
    action: NonEmptyIdSchema,
    args: z.unknown().optional(),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("event.publish"),
    topic: NonEmptyIdSchema,
    payload: z.unknown().optional(),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("attachment.put"),
    name: z.string().min(1).max(255),
    mimeType: z.string().max(255),
    // 结构化克隆/跨 realm 中继后 instanceof 失真,以 brand 判别。
    bytes: z.custom<ArrayBuffer>((value) => Object.prototype.toString.call(value) === "[object ArrayBuffer]"),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("conversation.submit"),
    text: z.string().min(1).max(100_000),
    attachmentIds: z.array(z.string().min(1).max(256)).max(64).optional(),
  }),
  // 共享状态的**写回**。读与订阅不走上行请求 —— 它们由宿主按授权键主动推 `pane:state`
  // (与 `pane:surface` 同构),故此处只有写。
  RequestBaseSchema.extend({
    operation: z.literal("state.set"),
    key: NonEmptyIdSchema,
    value: z.unknown(),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("state.delete"),
    key: NonEmptyIdSchema,
  }),
]);
export type PaneGuestRequest = z.infer<typeof PaneGuestRequestSchema>;

export const PaneErrorCodeSchema = z.enum([
  "INVALID_MESSAGE",
  "STALE_INSTANCE",
  "CAPABILITY_DENIED",
  "PAYLOAD_TOO_LARGE",
  "REVISION_CONFLICT",
  "ROUTE_FAILED",
  "ATTACHMENT_FAILED",
  "HOST_UNAVAILABLE",
  "REQUEST_TIMEOUT",
]);
export type PaneErrorCode = z.infer<typeof PaneErrorCodeSchema>;

export interface PaneErrorData {
  readonly code: PaneErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly status?: number;
}

export interface PaneTheme {
  readonly colorScheme?: string;
  readonly tokens: Readonly<Record<string, string>>;
}

export interface PaneConnectedMessage {
  readonly type: "pane:connected";
  readonly protocol: typeof PANE_PROTOCOL_VERSION;
  readonly instance: Pick<PaneInstance, "instanceId" | "paneId" | "epoch">;
  readonly grants: PaneCapabilities;
  readonly interactionMode: "standard" | "advanced";
  readonly theme?: PaneTheme;
}

export interface PaneReadyMessage {
  readonly type: "pane:ready";
  readonly protocol: typeof PANE_PROTOCOL_VERSION;
  readonly paneId: string;
}

export type PaneHostMessage =
  | PaneConnectedMessage
  | { readonly type: "pane:theme"; readonly theme: PaneTheme }
  | { readonly type: "pane:result"; readonly requestId: string; readonly ok: true; readonly data: unknown }
  | { readonly type: "pane:result"; readonly requestId: string; readonly ok: false; readonly error: PaneErrorData }
  | { readonly type: "pane:surface"; readonly key: string; readonly value: unknown }
  /**
   * 宿主 → pane 的**共享状态**推送(spec panes-only-right-panel Req 2.1/2.2)。
   *
   * 与 `pane:surface` 形态相同、事实源不同:`pane:surface` 是 agent 权威快照(只读),
   * 这条是会话级共享 KV(人与 agent 双向读写)。分开是因为混用会让「谁是权威」失去意义。
   */
  | { readonly type: "pane:state"; readonly key: string; readonly value: unknown }
  /**
   * 宿主 → pane 的**具名信号**(纯下行,无应答)。
   *
   * 与 `pane:surface` 的区别是事实源:`pane:surface` 搬运的是 **agent 权威快照**,
   * 而信号搬运的是**只存在于宿主 realm 的东西** —— 主题类、宿主 chrome 上的点击、轮次边沿。
   * 这些既不属于 agent 状态、也无法由 pane 自己观察到(iframe 是独立 document)。
   *
   * 加这条之前,同一个缺口已经被绕过三次:轮末 `syncSignal`(示例侧包装器代发命令)、
   * 宿主主题切换(pane 永远亮色)、聊天工具卡点图打开工作台(document 监听落在 iframe 里)。
   * 三次绕不过去说明缺的是原语,不是用法。
   *
   * 语义:**最后值即真值**(非事件流)。新建连接时宿主重推全部当前值,故 pane 晚连也不丢。
   *
   * ⚠ 与下方 `pane:event` 是**两条不同的下行原语**,勿合并:
   * `pane:signal` 是宿主 realm → pane 的具名**状态值**(最后值即真值,无发送方身份);
   * `pane:event` 是 pane ↔ pane 的**代理事件流**(带 `source` 标识发送方,不保留最后值)。
   */
  | { readonly type: "pane:signal"; readonly name: string; readonly value: unknown }
  | {
      readonly type: "pane:event";
      readonly topic: string;
      readonly payload: unknown;
      readonly source: Pick<PaneInstance, "instanceId" | "paneId">;
    }
  | { readonly type: "pane:lifecycle"; readonly state: "visible" | "hidden" | "closing" };

export function definePaneDefinition(input: PaneDefinitionInput): PaneDefinition {
  return PaneDefinitionSchema.parse(input);
}

export function definePanes(input: PanesDefinitionInput): PanesDefinition {
  const definition = PanesDefinitionSchema.parse(input);
  const ids = new Set<string>();
  for (const pane of definition.panes) {
    if (ids.has(pane.id)) throw new Error(`Duplicate pane id: ${pane.id}`);
    ids.add(pane.id);
    if (!pane.allowMultiple && pane.maxInstances !== 1) {
      throw new Error(`Pane ${pane.id} sets maxInstances > 1 without allowMultiple`);
    }
  }
  const initialPaneIds = definition.initialPaneIds ?? [definition.panes[0]!.id];
  if (initialPaneIds.length > definition.maxOpenPanes) throw new Error("Initial panes exceed maxOpenPanes");
  const initialCounts = new Map<string, number>();
  for (const paneId of initialPaneIds) {
    if (!ids.has(paneId)) throw new Error(`Unknown initial pane id: ${paneId}`);
    const pane = definition.panes.find((candidate) => candidate.id === paneId)!;
    const count = (initialCounts.get(paneId) ?? 0) + 1;
    initialCounts.set(paneId, count);
    if ((!pane.allowMultiple && count > 1) || count > pane.maxInstances) {
      throw new Error(`Initial pane ${paneId} exceeds its instance limit`);
    }
  }
  return definition;
}

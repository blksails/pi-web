import { z } from "zod";

export const PANE_PROTOCOL_VERSION = 1 as const;

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
  attachments: z.enum(["none", "read", "read-write"]).default("none"),
  conversation: z.enum(["none", "submit"]).default("none"),
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
  document: PaneDocumentSchema,
  capabilities: PaneCapabilitiesSchema,
  allowMultiple: z.boolean().default(false),
  maxInstances: z.number().int().min(1).max(32).default(1),
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
  maxOpenPanes: z.number().int().min(1).max(64).default(16),
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
    operation: z.literal("attachment.put"),
    name: z.string().min(1).max(255),
    mimeType: z.string().max(255),
    bytes: z.instanceof(ArrayBuffer),
  }),
  RequestBaseSchema.extend({
    operation: z.literal("conversation.submit"),
    text: z.string().min(1).max(100_000),
    attachmentIds: z.array(z.string().min(1).max(256)).max(64).optional(),
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

export interface PaneConnectedMessage {
  readonly type: "pane:connected";
  readonly protocol: typeof PANE_PROTOCOL_VERSION;
  readonly instance: Pick<PaneInstance, "instanceId" | "paneId" | "epoch">;
  readonly grants: PaneCapabilities;
  readonly interactionMode: "standard" | "advanced";
}

export interface PaneReadyMessage {
  readonly type: "pane:ready";
  readonly protocol: typeof PANE_PROTOCOL_VERSION;
  readonly paneId: string;
}

export type PaneHostMessage =
  | PaneConnectedMessage
  | { readonly type: "pane:result"; readonly requestId: string; readonly ok: true; readonly data: unknown }
  | { readonly type: "pane:result"; readonly requestId: string; readonly ok: false; readonly error: PaneErrorData }
  | { readonly type: "pane:surface"; readonly key: string; readonly value: unknown }
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

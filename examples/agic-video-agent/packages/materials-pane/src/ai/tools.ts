import { Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  MaterialsApplicationError,
  getMaterialsApplicationService,
  legacyMaterialsCommand,
  type MaterialsApplicationService,
} from "../application/index.js";

type ToolSchema = ReturnType<typeof Type.Object>;

export interface MaterialsToolDefinition {
  readonly name:
    | "materials_search"
    | "materials_get"
    | "materials_status"
    | "materials_manage"
    | "materials_locate"
    | "materials_distribute";
  readonly label: string;
  readonly description: string;
  readonly parameters: ToolSchema;
  execute(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is number => Number.isSafeInteger(item) && item > 0)
        .map(String)
    : [];
}

function resultError(error: unknown): Record<string, unknown> {
  const known = error instanceof MaterialsApplicationError ? error : undefined;
  return {
    ok: false,
    error: {
      code: known?.code ?? "webapp_unavailable",
      message: known?.message ?? String(error),
      status: known?.status ?? 503,
      retryable: known?.retryable ?? true,
    },
  };
}

async function safe(
  run: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...await run() };
  } catch (error) {
    return resultError(error);
  }
}

const IDS = Type.Array(Type.Number({ minimum: 1, multipleOf: 1 }), {
  minItems: 1,
  maxItems: 50,
  description: "Stable enterprise material ids (without the material: prefix).",
});

const CONFIRMATION = {
  confirmed: Type.Literal(true, {
    description: "Explicit user confirmation for a dangerous write.",
  }),
  idempotencyKey: Type.String({
    minLength: 8,
    description: "Caller-stable key reused only when retrying the same write.",
  }),
};

/** MCP 与 Pi CustomTools 共用此唯一 schema/执行定义。 */
export function createMaterialsToolDefinitions(
  service: MaterialsApplicationService = getMaterialsApplicationService(),
): readonly MaterialsToolDefinition[] {
  return [
    {
      name: "materials_search",
      label: "Materials search",
      description: "Search the current signed-in tenant's enterprise material library.",
      parameters: Type.Object({
        search: Type.Optional(Type.String()),
        type: Type.Optional(
          Type.Union([
            Type.Literal("IMAGE"),
            Type.Literal("VIDEO"),
            Type.Literal("AUDIO"),
            Type.Literal("SCRIPT"),
          ]),
        ),
        folderId: Type.Optional(Type.Number({ minimum: 1, multipleOf: 1 })),
        includeSub: Type.Optional(Type.Boolean()),
        page: Type.Optional(Type.Number({ minimum: 1 })),
        pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })),
      }),
      execute: (params) => safe(() => service.query({
        kind: "search",
        ...(typeof params.search === "string" ? { search: params.search } : {}),
        ...(params.type === "IMAGE" || params.type === "VIDEO" || params.type === "AUDIO"
          ? { materialKind: params.type.toLowerCase() as "image" | "video" | "audio" }
          : {}),
        ...(typeof params.folderId === "number"
          ? { folderId: String(params.folderId) }
          : {}),
        ...(params.includeSub === true ? { includeSub: true } : {}),
        ...(typeof params.page === "number" ? { page: params.page } : {}),
        ...(typeof params.pageSize === "number" ? { pageSize: params.pageSize } : {}),
      })),
    },
    {
      name: "materials_get",
      label: "Materials get",
      description: "Resolve stable enterprise material ids to lightweight metadata and URLs.",
      parameters: Type.Object({ ids: IDS }),
      execute: (params) => safe(() => service.query({
        kind: "get",
        ids: ids(params.ids),
      })),
    },
    {
      name: "materials_status",
      label: "Materials status",
      description: "Read distribution status for enterprise materials.",
      parameters: Type.Object({ ids: IDS }),
      execute: (params) => safe(() => service.query({
        kind: "status",
        ids: ids(params.ids),
      })),
    },
    {
      name: "materials_manage",
      label: "Materials manage",
      description:
        "Create/rename/delete folders or rename/move/delete materials. " +
        "Dangerous and batch writes require confirmed=true plus idempotencyKey.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("create-folder"),
          Type.Literal("rename-folder"),
          Type.Literal("delete-folder"),
          Type.Literal("move-materials"),
          Type.Literal("rename"),
          Type.Literal("delete"),
        ]),
        id: Type.Optional(Type.Number({ minimum: 1, multipleOf: 1 })),
        ids: Type.Optional(IDS),
        name: Type.Optional(Type.String()),
        parentId: Type.Optional(
          Type.Union([Type.Number({ minimum: 1, multipleOf: 1 }), Type.Null()]),
        ),
        folderId: Type.Optional(
          Type.Union([Type.Number({ minimum: 1, multipleOf: 1 }), Type.Null()]),
        ),
        items: Type.Optional(Type.Array(Type.Object({
          id: Type.Number({ minimum: 1, multipleOf: 1 }),
          name: Type.String(),
        }), { maxItems: 50 })),
        confirmed: Type.Optional(Type.Boolean()),
        idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 200 })),
      }),
      execute: (params) => safe(() => service.execute(legacyMaterialsCommand({
        ...params,
        op: params.operation,
        ...(typeof params.id === "number" ? { id: String(params.id) } : {}),
        ...(Array.isArray(params.ids) ? { ids: ids(params.ids) } : {}),
        ...(typeof params.parentId === "number"
          ? { parentId: String(params.parentId) }
          : {}),
        ...(typeof params.folderId === "number"
          ? { folderId: String(params.folderId) }
          : {}),
        ...(Array.isArray(params.items)
          ? {
              items: params.items.map((value) => {
                const item = value as Record<string, unknown>;
                return { ...item, id: String(item.id ?? "") };
              }),
            }
          : {}),
      }))),
    },
    {
      name: "materials_locate",
      label: "Materials locate",
      description: "Locate the generation source/session for one enterprise material.",
      parameters: Type.Object({
        id: Type.Number({ minimum: 1, multipleOf: 1 }),
      }),
      execute: (params) => safe(() => service.query({
        kind: "locate",
        id: typeof params.id === "number" ? String(params.id) : "",
      })),
    },
    {
      name: "materials_distribute",
      label: "Materials distribute",
      description:
        "Submit materials to advertiser accounts. Rechecks BFF authorization; " +
        "requires explicit confirmation and a caller-stable idempotency key.",
      parameters: Type.Object({
        ids: IDS,
        advertiserIds: IDS,
        ...CONFIRMATION,
      }),
      execute: (params) => safe(() => service.execute(legacyMaterialsCommand({
        op: "distribute",
        ids: ids(params.ids),
        advertiserIds: ids(params.advertiserIds),
        confirmed: params.confirmed,
        idempotencyKey: params.idempotencyKey,
      }))),
    },
  ];
}

function toolResult(
  payload: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function registerMaterialsCustomTools(
  pi: ExtensionAPI,
  service: MaterialsApplicationService = getMaterialsApplicationService(),
): void {
  for (const definition of createMaterialsToolDefinitions(service)) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      execute: async (_id, params: Record<string, unknown>) =>
        toolResult(await definition.execute(params)),
    });
  }
}

/**
 * 默认走现有 pi-labs MCP，免同次部署重复暴露同义工具；
 * 显式 `PI_LABS_MATERIALS_AI_ADAPTER=custom-tools` 才注册进程内工具。
 */
export function makeMaterialsToolsExtension(
  env: NodeJS.ProcessEnv = process.env,
  service?: MaterialsApplicationService,
): ExtensionFactory {
  return (pi) => {
    if (env.PI_LABS_MATERIALS_AI_ADAPTER !== "custom-tools") return;
    registerMaterialsCustomTools(pi, service);
  };
}

export const materialsToolsExtension = makeMaterialsToolsExtension();

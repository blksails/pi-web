import {
  MaterialsApplicationError,
  type MaterialsApplicationService,
  type MaterialsAuditRecord,
  type MaterialsCommand,
  type MaterialsLibraryItem,
  type MaterialsQuery,
  type MaterialsResultMeta,
} from "./contracts.js";
import { signalMaterialsInvalidation } from "./invalidation.js";
import {
  getMaterialsPlatformClient,
  type MaterialsPlatformClient,
} from "../platform.js";

const DEFAULT_WEBAPP_URL = "http://127.0.0.1:4000";
const DEFAULT_TRUSTED_ORIGINS = new Set([
  "http://127.0.0.1:4000",
  "http://localhost:4000",
]);

type Environment = NodeJS.ProcessEnv;
type Fetch = typeof globalThis.fetch;

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: Promise<Record<string, unknown> & MaterialsResultMeta>;
}

export interface MaterialsApplicationDependencies {
  readonly env?: Environment;
  readonly fetch?: Fetch;
  readonly getPlatform?: () => MaterialsPlatformClient;
  readonly audit?: (record: MaterialsAuditRecord) => void | Promise<void>;
  readonly now?: () => string;
  readonly requestId?: () => string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MaterialsApplicationError(
      "invalid_request",
      `${field} must be a non-empty string.`,
      400,
    );
  }
  return value.trim();
}

function uniqueStrings(
  value: readonly string[],
  field: string,
  max = 200,
): string[] {
  const ids = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > max) {
    throw new MaterialsApplicationError(
      "invalid_request",
      `${field} must contain 1-${max} unique ids.`,
      400,
    );
  }
  return ids;
}

function trustedOrigins(env: Environment): ReadonlySet<string> {
  const origins = new Set(DEFAULT_TRUSTED_ORIGINS);
  const configuredWebappUrl = env.PI_LABS_WEBAPP_URL?.trim();
  if (configuredWebappUrl) {
    try {
      origins.add(new URL(configuredWebappUrl).origin);
    } catch {
      // 非法显式地址不授信。
    }
  }
  const configured =
    env.PI_LABS_WEBAPP_TRUSTED_ORIGINS ??
    env.PI_LABS_MCP_TRUSTED_ORIGINS ??
    "";
  for (const raw of configured.split(",")) {
    const value = raw.trim();
    if (value === "") continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // 非法扩展项不授信。
    }
  }
  return origins;
}

/** 动态宿主凭据仅可发往本地默认或显式受信 origin。 */
export function isTrustedMaterialsApiUrl(
  rawUrl: string,
  env: Environment = process.env,
): boolean {
  try {
    return trustedOrigins(env).has(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}

export function materialsAuthorization(env: Environment): string | undefined {
  const scoped = (
    env.PI_LABS_WEBAPP_AUTHORIZATION ??
    env.PI_LABS_MCP_AUTHORIZATION
  )?.trim();
  if (scoped !== undefined && scoped !== "") {
    if (!/^Bearer\s+\S+$/i.test(scoped)) {
      throw new MaterialsApplicationError(
        "invalid_authorization",
        "PI_LABS_WEBAPP_AUTHORIZATION must be a Bearer authorization value.",
        401,
      );
    }
    return scoped;
  }
  const credential = env.PI_WEB_DESKTOP_CREDENTIAL?.trim();
  return credential === undefined || credential === ""
    ? undefined
    : `Bearer ${credential}`;
}

export function materialsApiUrl(env: Environment = process.env): URL {
  let url: URL;
  try {
    url = new URL(
      "/api/agent/materials",
      env.PI_LABS_WEBAPP_URL ?? DEFAULT_WEBAPP_URL,
    );
  } catch {
    throw new MaterialsApplicationError(
      "invalid_webapp_url",
      "PI_LABS_WEBAPP_URL must be an absolute HTTP(S) URL.",
      500,
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new MaterialsApplicationError(
      "invalid_webapp_url",
      "PI_LABS_WEBAPP_URL must be an absolute HTTP(S) URL.",
      500,
    );
  }
  return url;
}

export function projectMaterial(value: unknown): MaterialsLibraryItem | undefined {
  const row = asRecord(value);
  if (row === undefined) return undefined;
  const materialId = String(row.id ?? "").trim();
  if (materialId === "") return undefined;
  const fileUrl = typeof row.file_url === "string" ? row.file_url : "";
  const coverUrl = typeof row.cover_url === "string" ? row.cover_url : "";
  const libraryAssetId =
    typeof row.library_asset_id === "string" && row.library_asset_id.trim() !== ""
      ? row.library_asset_id.trim()
      : undefined;
  const origin =
    row.origin === "aigc" || row.origin === "webapp_ref"
      ? row.origin
      : undefined;
  return {
    assetId: libraryAssetId === undefined
      ? `material:${materialId}`
      : `library:${libraryAssetId}`,
    displayUrl: coverUrl || fileUrl,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    meta: {
      materialId,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      ...(typeof row.type === "string" ? { type: row.type } : {}),
      ...(fileUrl !== "" ? { fileUrl } : {}),
      ...(row.folder_id !== null && row.folder_id !== undefined
        ? { folderId: String(row.folder_id) }
        : {}),
      ...(libraryAssetId === undefined ? {} : { libraryAssetId }),
      ...(origin === undefined ? {} : { origin }),
      ...(Array.isArray(row.accounts) ? { accounts: row.accounts } : {}),
    },
  };
}

function pageParams(
  query: Extract<MaterialsQuery, { kind: "search" | "library" }>,
): URLSearchParams {
  const page = Number.isInteger(query.page) ? Math.max(1, query.page ?? 1) : 1;
  const pageSize = Number.isInteger(query.pageSize)
    ? Math.min(120, Math.max(1, query.pageSize ?? 40))
    : 40;
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    include: "meta",
  });
  if (query.materialKind !== undefined) params.set("type", query.materialKind.toUpperCase());
  return params;
}

function queryString(query: Extract<MaterialsQuery, { kind: "search" }>): URLSearchParams {
  const params = pageParams(query);
  if (query.folderId !== undefined) params.set("folderId", query.folderId);
  if (query.includeSub === true) params.set("includeSub", "true");
  if (query.search?.trim()) params.set("search", query.search.trim());
  return params;
}

function commandRequest(
  command: MaterialsCommand,
  env: Environment = process.env,
): Record<string, unknown> {
  switch (command.kind) {
    case "add-to-library": {
      // webapp idsOf 要求正整数；统一压成数字字符串。
      const ids = uniqueStrings(command.ids, "ids").map((id) => {
        const n = Number(id);
        if (!Number.isSafeInteger(n) || n <= 0) {
          throw new MaterialsApplicationError(
            "invalid_request",
            `Invalid material id: ${id}`,
            400,
          );
        }
        return n;
      });
      return {
        op: "add-to-library",
        ids,
        sessionId: nonEmptyString(env.PI_WEB_SESSION_ID, "PI_WEB_SESSION_ID"),
      };
    }
    case "create-folder":
      return { op: "create-folder", name: command.name, parentId: command.parentId };
    case "rename-folder":
      return { op: "rename-folder", id: command.id, name: command.name };
    case "delete-folder":
      return { op: "delete-folder", id: command.id };
    case "move-materials":
      return { op: "move-materials", ids: command.ids, folderId: command.folderId };
    case "rename-materials":
      return { op: "rename", items: command.items };
    case "delete-materials":
      return { op: "delete", ids: command.ids };
    case "distribute":
      return {
        op: "distribute",
        ids: command.ids,
        advertiserIds: command.advertiserIds,
      };
  }
}

function commandEntityIds(command: MaterialsCommand): string[] {
  if (command.kind === "create-folder") return [];
  if (command.kind === "rename-folder" || command.kind === "delete-folder") {
    return [command.id];
  }
  if (command.kind === "rename-materials") return command.items.map(({ id }) => id);
  return [...command.ids];
}

function safety(command: MaterialsCommand): {
  readonly idempotencyKey?: string;
  readonly required: boolean;
} {
  const idempotencyKey =
    "idempotencyKey" in command ? command.idempotencyKey : undefined;
  if (
    command.kind === "delete-folder" ||
    command.kind === "move-materials" ||
    command.kind === "delete-materials" ||
    command.kind === "distribute"
  ) {
    return { required: true, idempotencyKey };
  }
  if (command.kind === "rename-materials" && command.items.length > 1) {
    return { required: true, idempotencyKey };
  }
  return { required: false, idempotencyKey };
}

function validateCommand(command: MaterialsCommand): MaterialsCommand {
  switch (command.kind) {
    case "add-to-library":
      uniqueStrings(command.ids, "ids");
      break;
    case "create-folder":
      nonEmptyString(command.name, "name");
      break;
    case "rename-folder":
      nonEmptyString(command.id, "id");
      nonEmptyString(command.name, "name");
      break;
    case "delete-folder":
      nonEmptyString(command.id, "id");
      break;
    case "move-materials":
    case "delete-materials":
      uniqueStrings(command.ids, "ids");
      break;
    case "rename-materials":
      if (command.items.length === 0 || command.items.length > 200) {
        throw new MaterialsApplicationError(
          "invalid_request",
          "items must contain 1-200 entries.",
          400,
        );
      }
      for (const item of command.items) {
        nonEmptyString(item.id, "items[].id");
        nonEmptyString(item.name, "items[].name");
      }
      break;
    case "distribute":
      uniqueStrings(command.ids, "ids");
      uniqueStrings(command.advertiserIds, "advertiserIds");
      break;
  }
  const guard = safety(command);
  if (guard.required) {
    if (!("confirmed" in command) || command.confirmed !== true) {
      throw new MaterialsApplicationError(
        "confirmation_required",
        "This operation requires explicit confirmation.",
        400,
      );
    }
    if (
      typeof guard.idempotencyKey !== "string" ||
      guard.idempotencyKey.trim() === ""
    ) {
      throw new MaterialsApplicationError(
        "idempotency_key_required",
        "This operation requires an idempotency key.",
        400,
      );
    }
  }
  return command;
}

function errorFromResponse(
  response: Response,
  body: Record<string, unknown> | undefined,
): MaterialsApplicationError {
  const error = asRecord(body?.error);
  const upstreamCode = typeof error?.code === "string" ? error.code : undefined;
  const message = typeof error?.message === "string"
    ? error.message
    : "Materials webapp API rejected the request.";
  if (response.status === 401) {
    return new MaterialsApplicationError("unauthorized", message, 401);
  }
  if (response.status === 403) {
    return new MaterialsApplicationError("forbidden", message, 403);
  }
  if (response.status === 404) {
    return new MaterialsApplicationError("not_found", message, 404);
  }
  if (response.status === 409) {
    return new MaterialsApplicationError("conflict", message, 409);
  }
  return new MaterialsApplicationError(
    upstreamCode === "unauthorized" ||
      upstreamCode === "forbidden" ||
      upstreamCode === "not_found" ||
      upstreamCode === "conflict" ||
      upstreamCode === "folders_list_failed"
      ? upstreamCode
      : "materials_request_failed",
    message,
    response.status,
    response.status >= 500,
  );
}

function defaultAudit(record: MaterialsAuditRecord): void {
  process.stderr.write(`[materials-audit] ${JSON.stringify(record)}\n`);
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `materials-${Date.now()}`;
}

/** 企业素材唯一应用服务；Pane、MCP、CustomTools 皆止于此层。 */
export function createMaterialsApplicationService(
  dependencies: MaterialsApplicationDependencies = {},
): MaterialsApplicationService {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch;
  const getPlatform = dependencies.getPlatform ?? (() => getMaterialsPlatformClient(env));
  const audit = dependencies.audit ?? defaultAudit;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const nextRequestId = dependencies.requestId ?? createRequestId;
  const idempotency = new Map<string, IdempotencyEntry>();
  const writeAudit = async (record: MaterialsAuditRecord): Promise<void> => {
    try {
      await audit(record);
    } catch {
      defaultAudit(record);
    }
  };

  const request = async (
    body: Record<string, unknown> | undefined,
    params = new URLSearchParams(),
    requestId = nextRequestId(),
    idempotencyKey?: string,
    confirmed = false,
  ): Promise<Record<string, unknown>> => {
    const url = materialsApiUrl(env);
    const bearer = materialsAuthorization(env);
    if (bearer === undefined) {
      throw new MaterialsApplicationError(
        "unauthorized",
        "Host authorization rejected.",
        401,
      );
    }
    if (!isTrustedMaterialsApiUrl(url.href, env)) {
      throw new MaterialsApplicationError(
        "untrusted_webapp_origin",
        "Refusing to send session authorization to an untrusted webapp origin.",
        403,
      );
    }
    url.search = params.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await (fetchImpl ?? globalThis.fetch)(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          authorization: bearer,
          "x-request-id": requestId,
          ...(idempotencyKey === undefined
            ? {}
            : { "x-idempotency-key": idempotencyKey }),
          ...(confirmed ? { "x-materials-confirmed": "true" } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch {
      throw new MaterialsApplicationError(
        "webapp_unavailable",
        "Materials webapp API is unavailable.",
        503,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    const responseBody = asRecord(await response.json().catch(() => undefined));
    if (!response.ok) throw errorFromResponse(response, responseBody);
    if (responseBody === undefined) {
      throw new MaterialsApplicationError(
        "invalid_webapp_response",
        "Materials webapp API returned an invalid response.",
        502,
        true,
      );
    }
    return responseBody;
  };

  const query = async (input: MaterialsQuery): Promise<Record<string, unknown>> => {
    const requestId = nextRequestId();
    switch (input.kind) {
      case "library": {
        const params = pageParams(input);
        params.set("track", "library");
        params.set(
          "sessionId",
          nonEmptyString(env.PI_WEB_SESSION_ID, "PI_WEB_SESSION_ID"),
        );
        const result = await request(undefined, params, requestId);
        const items = (Array.isArray(result.items) ? result.items : [])
          .map(projectMaterial)
          .filter((item): item is MaterialsLibraryItem => item !== undefined);
        const total = Number(result.total ?? items.length);
        return {
          items,
          total: Number.isFinite(total) ? total : items.length,
          page: Number(params.get("page")),
          pageSize: Number(params.get("pageSize")),
          source: "webapp-library",
          requestId,
        };
      }
      case "search": {
        const params = queryString(input);
        let result: Record<string, unknown>;
        try {
          result = await request(undefined, params, requestId);
        } catch (error) {
          if (!(error instanceof MaterialsApplicationError) || error.code !== "folders_list_failed") {
            throw error;
          }
          // 生产目录 RPC 故障时仍返回真实素材；下次刷新会先重试完整元数据。
          params.delete("include");
          result = await request(undefined, params, requestId);
        }
        const items = (Array.isArray(result.items) ? result.items : [])
          .map(projectMaterial)
          .filter((item): item is MaterialsLibraryItem => item !== undefined);
        const page = Number(params.get("page"));
        const pageSize = Number(params.get("pageSize"));
        const total = Number(result.total ?? items.length);
        return {
          items,
          total: Number.isFinite(total) ? total : items.length,
          page,
          pageSize,
          folders: Array.isArray(result.folders) ? result.folders : [],
          canDistribute: result.canDistribute === true,
          advertisers: Array.isArray(result.advertisers) ? result.advertisers : [],
          source: "webapp",
          requestId,
        };
      }
      case "get": {
        const ids = uniqueStrings(input.ids, "ids", 16);
        const result = await request(
          { op: "resolve", ids },
          new URLSearchParams(),
          requestId,
        );
        const items = (Array.isArray(result.items) ? result.items : [])
          .map(projectMaterial)
          .filter((item): item is MaterialsLibraryItem => item !== undefined);
        return { ...result, items, requestId };
      }
      case "locate":
        return {
          ...await request(
            { op: "locate", id: nonEmptyString(input.id, "id") },
            new URLSearchParams(),
            requestId,
          ),
          requestId,
        };
      case "status": {
        const ids = uniqueStrings(input.ids, "ids");
        const platform = getPlatform();
        if (!platform.available) {
          throw new MaterialsApplicationError(
            "platform_unavailable",
            "Materials status service is unavailable.",
            503,
            true,
          );
        }
        const result = await platform.listMaterialStatus(ids);
        return { ...(asRecord(result) ?? { items: [] }), requestId };
      }
    }
  };

  const runCommand = async (
    command: MaterialsCommand,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown> & MaterialsResultMeta> => {
    try {
      const body = await request(
        commandRequest(command, env),
        new URLSearchParams(),
        requestId,
        idempotencyKey,
        safety(command).required,
      );
      const result = {
        ...body,
        requestId,
        refresh: {
          resource: "enterprise-materials" as const,
          strategy: "reload" as const,
          revision: signalMaterialsInvalidation(requestId).revision,
        },
      };
      await writeAudit({
        at: now(),
        requestId,
        operation: command.kind,
        outcome: "success",
        entityIds: commandEntityIds(command),
        count: commandEntityIds(command).length,
      });
      return result;
    } catch (error) {
      const known = error instanceof MaterialsApplicationError ? error : undefined;
      await writeAudit({
        at: now(),
        requestId,
        operation: command.kind,
        outcome: "failure",
        entityIds: commandEntityIds(command),
        count: commandEntityIds(command).length,
        ...(known === undefined ? {} : { errorCode: known.code }),
      });
      throw error;
    }
  };

  return {
    query,
    async execute(command) {
      const requestId = nextRequestId();
      let validated: MaterialsCommand;
      try {
        validated = validateCommand(command);
      } catch (error) {
        const known = error instanceof MaterialsApplicationError ? error : undefined;
        await writeAudit({
          at: now(),
          requestId,
          operation: command.kind,
          outcome: "failure",
          entityIds: commandEntityIds(command),
          count: commandEntityIds(command).length,
          ...(known === undefined ? {} : { errorCode: known.code }),
        });
        throw error;
      }
      const key = safety(validated).idempotencyKey?.trim();
      if (key === undefined) return await runCommand(validated, requestId);
      const fingerprint = JSON.stringify(commandRequest(validated, env));
      const previous = idempotency.get(key);
      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) {
          const error = new MaterialsApplicationError(
            "idempotency_conflict",
            "Idempotency key was already used for another operation.",
            409,
          );
          await writeAudit({
            at: now(),
            requestId,
            operation: validated.kind,
            outcome: "failure",
            entityIds: commandEntityIds(validated),
            count: commandEntityIds(validated).length,
            errorCode: error.code,
          });
          throw error;
        }
        return await previous.result;
      }
      const result = runCommand(validated, requestId, key).catch((error) => {
        idempotency.delete(key);
        throw error;
      });
      idempotency.set(key, { fingerprint, result });
      if (idempotency.size > 512) {
        const oldest = idempotency.keys().next().value as string | undefined;
        if (oldest !== undefined) idempotency.delete(oldest);
      }
      return await result;
    },
  };
}

let defaultService: MaterialsApplicationService | undefined;

export function getMaterialsApplicationService(): MaterialsApplicationService {
  defaultService ??= createMaterialsApplicationService();
  return defaultService;
}

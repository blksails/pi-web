/**
 * `materials-library` Agent Route：保留 Pane HTTP 契约，仅作应用服务薄适配。
 */
import type {
  AgentRouteDecl,
  AgentRouteRequest,
} from "@blksails/pi-web-agent-kit";
import { getAttachmentToolContext } from "@blksails/pi-web-tool-kit/runtime";
import {
  MaterialsApplicationError,
  getMaterialsApplicationService,
  legacyMaterialsCommand,
  type MaterialsApplicationService,
} from "../application/index.js";
import {
  isTrustedMaterialsApiUrl,
  materialsApiUrl,
  materialsAuthorization,
  projectMaterial,
} from "../application/service.js";

export {
  isTrustedMaterialsApiUrl,
  materialsApiUrl,
  materialsAuthorization,
  projectMaterial,
} from "../application/service.js";
export type { MaterialsLibraryItem } from "../application/contracts.js";

const KINDS = new Set(["image", "video", "audio"]);

type AttachmentContext = ReturnType<typeof getAttachmentToolContext>;

export interface MaterialsLibraryDependencies {
  readonly service?: MaterialsApplicationService;
  readonly getAttachments?: () => AttachmentContext;
  readonly fetch?: typeof globalThis.fetch;
  readonly env?: NodeJS.ProcessEnv;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeAssetUrl(raw: string, env: NodeJS.ProcessEnv): URL | undefined {
  try {
    const url = new URL(raw);
    const trusted = (
      url.origin === "http://127.0.0.1:4000" ||
      url.origin === "http://localhost:4000" ||
      (env.PI_LABS_WEBAPP_URL !== undefined &&
        url.origin === new URL(env.PI_LABS_WEBAPP_URL).origin)
    );
    if (url.protocol !== "https:" && !trusted) return undefined;
    const host = url.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return privateHost && !trusted ? undefined : url;
  } catch {
    return undefined;
  }
}

function errorResult(error: unknown): Record<string, unknown> {
  const known = error instanceof MaterialsApplicationError ? error : undefined;
  const message = known?.code === "unauthorized"
    ? "请先登录，登录后重试加载素材库。"
    : known?.message ?? "Materials webapp API is unavailable.";
  return {
    error: known?.code ?? "webapp_unavailable",
    message,
    status: known?.status ?? 503,
    retryable: known?.retryable ?? true,
  };
}

async function uploadToDirectory(
  body: Record<string, unknown>,
  getAttachments: () => AttachmentContext,
  fetchImpl: typeof globalThis.fetch,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? [...new Set(body.attachmentIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== "",
      ))]
    : [];
  if (attachmentIds.length === 0 || attachmentIds.length > 16) {
    throw new MaterialsApplicationError(
      "invalid_request",
      "请选择 1–16 个待上传素材。",
      400,
    );
  }
  const ctx = getAttachments();
  if (!ctx.available) {
    throw new MaterialsApplicationError(
      "platform_unavailable",
      "当前会话不支持素材上传。",
      503,
      true,
    );
  }
  const bearer = materialsAuthorization(env);
  if (bearer === undefined) {
    throw new MaterialsApplicationError(
      "unauthorized",
      "Host authorization rejected.",
      401,
    );
  }
  const url = materialsApiUrl(env);
  url.pathname = "/api/materials/upload";
  url.search = "";
  if (!isTrustedMaterialsApiUrl(url.href, env)) {
    throw new MaterialsApplicationError(
      "untrusted_webapp_origin",
      "Refusing to send session authorization to an untrusted webapp origin.",
      403,
    );
  }
  const folderId =
    typeof body.folderId === "string" && /^\d+$/.test(body.folderId)
      ? body.folderId
      : undefined;
  const rows: unknown[] = [];
  let totalBytes = 0;
  for (const attachmentId of attachmentIds) {
    const handle = await ctx.resolve(attachmentId);
    const bytes = await handle.bytes();
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > 32 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
      throw new MaterialsApplicationError(
        "invalid_request",
        "素材过大，单项限 32MB、合计限 64MB。",
        413,
      );
    }
    const mimeType = handle.meta.mimeType || "application/octet-stream";
    const materialType = mimeType.startsWith("video/")
      ? "VIDEO"
      : mimeType.startsWith("audio/")
        ? "AUDIO"
        : mimeType.startsWith("image/")
          ? "IMAGE"
          : undefined;
    if (materialType === undefined) {
      throw new MaterialsApplicationError(
        "invalid_request",
        `不支持的素材类型: ${mimeType}`,
        400,
      );
    }
    const form = new FormData();
    form.append(
      "files",
      new File([Uint8Array.from(bytes).buffer], handle.meta.name || `${attachmentId}.bin`, {
        type: mimeType,
      }),
    );
    form.append("material_type", materialType);
    if (folderId !== undefined) form.append("folder_id", folderId);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: bearer,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const result = asRecord(await response.json().catch(() => undefined));
    if (!response.ok || result === undefined) {
      throw new MaterialsApplicationError(
        "materials_request_failed",
        typeof result?.error === "string"
          ? result.error
          : "素材上传失败。",
        response.status || 502,
        response.status >= 500,
      );
    }
    let linkedMaterialId: string | undefined;
    for (const value of Array.isArray(result.results) ? result.results : []) {
      const item = asRecord(value);
      if (item?.row === undefined) continue;
      rows.push(item.row);
      linkedMaterialId ??= projectMaterial(item.row)?.meta?.materialId;
    }
    if (linkedMaterialId !== undefined) {
      const currentMeta = await ctx.getMeta(attachmentId) ?? {};
      await ctx.setMeta(attachmentId, {
        ...currentMeta,
        materialId: linkedMaterialId,
      });
    }
  }
  return {
    ok: true,
    items: rows.flatMap((row) => {
      const item = projectMaterial(row);
      return item === undefined ? [] : [item];
    }),
  };
}

function parseSearch(req: AgentRouteRequest): Parameters<MaterialsApplicationService["query"]>[0] {
  const requestedPage = Number(req.query.page ?? 1);
  const requestedSize = Number(req.query.pageSize ?? 40);
  const materialKind =
    typeof req.query.kind === "string" && KINDS.has(req.query.kind)
      ? req.query.kind as "image" | "video" | "audio"
      : undefined;
  const page = Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageSize = Number.isInteger(requestedSize)
    ? Math.min(120, Math.max(1, requestedSize))
    : 40;
  if (req.query.track === "library") {
    return {
      kind: "library",
      page,
      pageSize,
      ...(materialKind === undefined ? {} : { materialKind }),
    };
  }
  return {
    kind: "search",
    page,
    pageSize,
    ...(materialKind === undefined ? {} : { materialKind }),
    ...(typeof req.query.folderId === "string"
      ? { folderId: req.query.folderId }
      : {}),
    ...(req.query.includeSub === "true" ? { includeSub: true } : {}),
    ...(typeof req.query.search === "string" && req.query.search.trim() !== ""
      ? { search: req.query.search.trim() }
      : {}),
  };
}

async function importToCanvas(
  body: Record<string, unknown>,
  service: MaterialsApplicationService,
  getAttachments: () => AttachmentContext,
  fetchImpl: typeof globalThis.fetch,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string"))]
    : [];
  if (ids.length === 0 || ids.length > 16) {
    return { error: "invalid_request", message: "请选择 1–16 个素材。" };
  }
  const sourceById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(body.sources)) {
    for (const value of body.sources) {
      const source = asRecord(value);
      if (source === undefined || typeof source.id !== "string" ||
          typeof source.url !== "string" || !ids.includes(source.id)) continue;
      sourceById.set(source.id, source);
    }
  }
  const rows = ids.every((id) => sourceById.has(id))
    ? ids.map((id) => {
        const source = sourceById.get(id)!;
        return {
          meta: {
            materialId: id,
            fileUrl: source.url,
            ...(typeof source.name === "string" ? { name: source.name } : {}),
            ...(typeof source.type === "string" ? { type: source.type } : {}),
          },
        };
      })
    : await service.query({ kind: "get", ids }).then((resolved) =>
        Array.isArray(resolved.items) ? resolved.items : []);
  const ctx = getAttachments();
  if (!ctx.available) {
    return { error: "attachments_unavailable", message: "当前会话不支持素材导入。" };
  }
  const attachmentIds: string[] = [];
  let totalBytes = 0;
  for (const value of rows) {
    const item = asRecord(value);
    const meta = asRecord(item?.meta);
    const url = safeAssetUrl(String(meta?.fileUrl ?? ""), env);
    if (url === undefined) continue;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > 32 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
      return {
        error: "asset_too_large",
        message: "素材过大，单项限 32MB、合计限 64MB。",
      };
    }
    const ref = await ctx.putOutput({
      bytes,
      name: typeof meta?.name === "string"
        ? meta.name
        : `material-${String(meta?.materialId ?? attachmentIds.length + 1)}`,
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
    });
    if (typeof meta?.materialId === "string" && meta.materialId !== "") {
      const currentMeta = await ctx.getMeta(ref.attachmentId) ?? {};
      await ctx.setMeta(ref.attachmentId, {
        ...currentMeta,
        materialId: meta.materialId,
      });
    }
    attachmentIds.push(ref.attachmentId);
  }
  return attachmentIds.length > 0
    ? { ok: true, attachmentIds }
    : { error: "asset_fetch_failed", message: "素材文件不可读取。" };
}

async function removeFromSessionLibrary(
  body: Record<string, unknown>,
  getAttachments: () => AttachmentContext,
): Promise<Record<string, unknown>> {
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? [...new Set(body.attachmentIds.filter(
        (id): id is string => typeof id === "string" && id !== "",
      ))]
    : [];
  if (attachmentIds.length === 0 || attachmentIds.length > 64) {
    return { error: "invalid_request", message: "请选择 1–64 个素材。" };
  }
  const ctx = getAttachments();
  if (!ctx.available) {
    return { error: "attachments_unavailable", message: "当前会话不支持素材删除。" };
  }
  const currentIds = new Set((await ctx.listBySession()).map((item) => item.id));
  const removable = attachmentIds.filter((id) => currentIds.has(id));
  if (removable.length === 0) {
    return { error: "asset_not_found", message: "素材不存在。" };
  }
  await Promise.all(removable.map(async (id) => {
    const meta = await ctx.getMeta(id) ?? {};
    await ctx.setMeta(id, { ...meta, materialsLibraryHidden: true });
  }));
  return { ok: true, attachmentIds: removable };
}

export function createMaterialsLibraryHandler(
  dependencies: MaterialsLibraryDependencies = {},
): (req: AgentRouteRequest) => Promise<unknown> {
  const service = dependencies.service ?? getMaterialsApplicationService();
  const getAttachments =
    dependencies.getAttachments ?? (() => getAttachmentToolContext());
  const fetchImpl = dependencies.fetch;
  const env = dependencies.env ?? process.env;
  return async (req: AgentRouteRequest): Promise<unknown> => {
    try {
      if (req.method !== "POST") return await service.query(parseSearch(req));
      const body = asRecord(req.body);
      if (body === undefined) {
        throw new MaterialsApplicationError(
          "invalid_request",
          "请求体须为 JSON 对象。",
          400,
        );
      }
      if (body.op === "import-to-canvas") {
        return await importToCanvas(
          body,
          service,
          getAttachments,
          fetchImpl ?? globalThis.fetch,
          env,
        );
      }
      if (body.op === "remove-from-session-library") {
        return await removeFromSessionLibrary(body, getAttachments);
      }
      if (body.op === "upload-to-directory") {
        return await uploadToDirectory(
          body,
          getAttachments,
          fetchImpl ?? globalThis.fetch,
          env,
        );
      }
      if (body.op === "resolve") {
        return await service.query({
          kind: "get",
          ids: Array.isArray(body.ids)
            ? body.ids.filter((id): id is string => typeof id === "string")
            : [],
        });
      }
      if (body.op === "locate") {
        return await service.query({
          kind: "locate",
          id: typeof body.id === "string" ? body.id : "",
        });
      }
      return await service.execute(legacyMaterialsCommand(body));
    } catch (error) {
      return errorResult(error);
    }
  };
}

export const materialsLibraryHandler = createMaterialsLibraryHandler();

export const materialsLibraryRoute: AgentRouteDecl = {
  name: "materials-library",
  methods: ["GET", "POST"],
  description: "当前登录租户的 webapp 素材库查询与受控写操作",
  handler: materialsLibraryHandler,
};

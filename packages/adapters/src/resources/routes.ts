import { errorResponse, jsonResponse } from "@blksails/pi-web-core/http/index.js";
import type { AuthContext, InjectedRoute, RequestContext, RouteHandler } from "@blksails/pi-web-core/http/index.js";
import { z } from "zod";
import { defaultAdminPolicy } from "../extensions/security/admin-policy.js";
import type { AdminPolicy } from "../extensions/ext.types.js";
import { RESOURCE_SCOPES, type ManagedResourceKind, type ResourceManager, type ResourceScope } from "./types.js";

const scopeSchema = z.enum(RESOURCE_SCOPES);
const textSchema = z.string().max(512 * 1024);
const createSkillSchema = z.object({
  scope: scopeSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  content: textSchema,
  overwrite: z.boolean().optional(),
});
const createTemplateSchema = z.object({
  scope: scopeSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  argumentHint: z.string().max(200).optional(),
  content: textSchema,
  overwrite: z.boolean().optional(),
});
const packageSchema = z.object({ scope: scopeSchema, source: z.string().min(1).max(2_048) });

export interface ResourceRoutesOptions {
  readonly manager: ResourceManager;
  readonly adminPolicy?: AdminPolicy;
}

function gate(adminPolicy: AdminPolicy, ctx: RequestContext): Response | undefined {
  if (adminPolicy(ctx.auth)) return undefined;
  return ctx.auth.anonymous
    ? errorResponse(401, "UNAUTHORIZED", "Admin authentication required.")
    : errorResponse(403, "FORBIDDEN", "Admin authorization denied.");
}

async function readJson(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

function parsePath(ctx: RequestContext): { readonly kind: ManagedResourceKind; readonly scope: ResourceScope; readonly name: string } | undefined {
  const parts = ctx.url.pathname.split("/").filter(Boolean);
  const resourceIndex = parts.lastIndexOf("resources");
  if (resourceIndex < 0 || parts.length !== resourceIndex + 4) return undefined;
  const kind = parts[resourceIndex + 1] === "skills" ? "skill" : parts[resourceIndex + 1] === "templates" ? "template" : undefined;
  const scope = scopeSchema.safeParse(parts[resourceIndex + 2]);
  const encodedName = parts[resourceIndex + 3];
  if (kind === undefined || !scope.success || encodedName === undefined || encodedName.length === 0) return undefined;
  try {
    return { kind, scope: scope.data, name: decodeURIComponent(encodedName) };
  } catch {
    return undefined;
  }
}

function operationError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Resource operation failed.";
  const status = /not configured|not supported|must be|escapes|Resource name/i.test(message) ? 422 : 500;
  return errorResponse(status, status === 422 ? "RESOURCE_VALIDATION_FAILED" : "RESOURCE_OPERATION_FAILED", message);
}

export function createResourceRoutes(opts: ResourceRoutesOptions): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;
  const list: RouteHandler = async (): Promise<Response> => {
    try {
      return jsonResponse(200, await opts.manager.list() as unknown as Record<string, unknown>);
    } catch (error) {
      return operationError(error);
    }
  };
  const createSkill: RouteHandler = async (ctx) => {
    const denied = gate(adminPolicy, ctx);
    if (denied !== undefined) return denied;
    try {
      const parsed = createSkillSchema.parse(await readJson(ctx.req));
      return jsonResponse(201, { resource: await opts.manager.createSkill(parsed) });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid skill request.");
      }
      return operationError(error);
    }
  };
  const createTemplate: RouteHandler = async (ctx) => {
    const denied = gate(adminPolicy, ctx);
    if (denied !== undefined) return denied;
    try {
      const parsed = createTemplateSchema.parse(await readJson(ctx.req));
      return jsonResponse(201, { resource: await opts.manager.createTemplate(parsed) });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid template request.");
      }
      return operationError(error);
    }
  };
  const install: RouteHandler = async (ctx) => {
    const denied = gate(adminPolicy, ctx);
    if (denied !== undefined) return denied;
    try {
      const parsed = packageSchema.parse(await readJson(ctx.req));
      await opts.manager.installPackage(parsed.scope, parsed.source);
      return jsonResponse(200, { ok: true, source: parsed.source, scope: parsed.scope });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid package request.");
      }
      return operationError(error);
    }
  };
  const removePackage: RouteHandler = async (ctx) => {
    const denied = gate(adminPolicy, ctx);
    if (denied !== undefined) return denied;
    try {
      const parsed = packageSchema.parse(await readJson(ctx.req));
      const removed = await opts.manager.removePackage(parsed.scope, parsed.source);
      return jsonResponse(200, { ok: removed, source: parsed.source, scope: parsed.scope });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid package request.");
      }
      return operationError(error);
    }
  };
  const remove: RouteHandler = async (ctx) => {
    const denied = gate(adminPolicy, ctx);
    if (denied !== undefined) return denied;
    const target = parsePath(ctx);
    if (target === undefined) return errorResponse(400, "INVALID_RESOURCE_PATH", "Invalid resource path.");
    try {
      await opts.manager.remove(target.kind, target.scope, target.name);
      return jsonResponse(200, { ok: true });
    } catch (error) {
      return operationError(error);
    }
  };
  return [
    { method: "GET", path: "/resources", handler: list },
    { method: "POST", path: "/resources/skills", handler: createSkill },
    { method: "POST", path: "/resources/templates", handler: createTemplate },
    { method: "POST", path: "/resources/packages/install", handler: install },
    { method: "POST", path: "/resources/packages/remove", handler: removePackage },
    { method: "DELETE", path: "/resources/skills/:scope/:name", handler: remove },
    { method: "DELETE", path: "/resources/templates/:scope/:name", handler: remove },
  ];
}

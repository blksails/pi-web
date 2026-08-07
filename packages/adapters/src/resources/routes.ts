import { errorResponse, jsonResponse } from "@blksails/pi-web-core/http/index.js";
import type {
  AuthContext,
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "@blksails/pi-web-core/http/index.js";
import { z } from "zod";
import { defaultAdminPolicy } from "../extensions/security/admin-policy.js";
import type { AdminPolicy } from "../extensions/ext.types.js";
import {
  SkillValidationError,
  type SkillSubmission,
  type SkillValidationReport,
  validateSkillSubmission,
} from "./skill-validator.js";
import {
  RESOURCE_SCOPES,
  type ManagedResourceKind,
  type ResourceCatalog,
  type ResourceManager,
  type ResourcePermissions,
  type ResourceScope,
  type ResourceScopePermission,
} from "./types.js";

const scopeSchema = z.enum(RESOURCE_SCOPES);
const kindSchema = z.enum(["skill", "template"]);
const textSchema = z.string().max(512 * 1024);
const coverImageSchema = z
  .string()
  .max(512 * 1024)
  .refine(
    (value) =>
      value.length === 0 ||
      /^https?:\/\//i.test(value) ||
      /^data:image\//i.test(value),
    "Cover image must be an http(s) URL or image data URI.",
  );
const resourceFields = {
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  argumentHint: z.string().max(200).optional(),
  sourceTitle: z.string().max(200).optional(),
  coverImage: coverImageSchema.optional(),
  content: textSchema,
  agentId: z.string().min(1).max(2_048).optional(),
};
const createSkillSchema = z.object({
  scope: scopeSchema,
  name: z.string().min(1).max(64),
  title: resourceFields.title,
  description: resourceFields.description,
  content: resourceFields.content,
  agentId: resourceFields.agentId,
  overwrite: z.boolean().optional(),
});
const createTemplateSchema = z.object({
  scope: scopeSchema,
  name: z.string().min(1).max(64),
  description: resourceFields.description,
  argumentHint: resourceFields.argumentHint,
  sourceTitle: resourceFields.sourceTitle,
  coverImage: resourceFields.coverImage,
  content: resourceFields.content,
  agentId: resourceFields.agentId,
  overwrite: z.boolean().optional(),
});
const updateResourceSchema = z.object({
  title: resourceFields.title,
  description: resourceFields.description,
  argumentHint: resourceFields.argumentHint,
  sourceTitle: resourceFields.sourceTitle,
  coverImage: resourceFields.coverImage,
  content: resourceFields.content,
  agentId: resourceFields.agentId,
});
const packageSchema = z.object({
  scope: scopeSchema,
  source: z.string().min(1).max(2_048),
  agentId: resourceFields.agentId,
});
const promoteSchema = z.object({
  targetScope: scopeSchema,
  sourceAgentId: resourceFields.agentId,
  targetAgentId: resourceFields.agentId,
  overwrite: z.boolean().optional(),
});

/** 已加载 Agent 的本地编辑目标。root 由服务端解析，绝不接受前端直接传路径。 */
export interface ResourceAgentTarget {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly publisherId?: string;
  readonly managerIds?: readonly string[];
}

export interface ResourceRoutesOptions {
  readonly manager: ResourceManager;
  /** 为已加载本地 Agent 创建绑定其 cwd 的资源管理器。 */
  readonly managerForAgent?: (root: string) => ResourceManager;
  /** 将已加载 Agent 的稳定 id 解析为本地目录及其编辑元数据。 */
  readonly resolveAgent?: (
    id: string,
    auth: AuthContext,
  ) => Promise<ResourceAgentTarget | undefined>;
  /** 列出已解析到本地、可供设置页选择的 Agent；不向前端暴露源目录路径。 */
  readonly listAgents?: (
    auth: AuthContext,
  ) => Promise<readonly Pick<ResourceAgentTarget, "id" | "name">[]>;
  /** 旧扩展管理门；启用时作为本地开发/部署管理员全量旁路。 */
  readonly adminPolicy?: AdminPolicy;
}

function roleIsCompanyAdmin(auth: AuthContext): boolean {
  const role = auth.role?.trim().toLowerCase();
  return !auth.anonymous && auth.companyId?.trim() !== "" &&
    (role === "owner" || role === "admin" || role === "administrator" ||
      role === "company_owner" || role === "company_admin" || role === "super_admin");
}

function agentCanEdit(auth: AuthContext, target: ResourceAgentTarget | undefined): boolean {
  if (auth.anonymous || target === undefined || auth.userId === undefined) return false;
  return target.publisherId === auth.userId || target.managerIds?.includes(auth.userId) === true;
}

function permission(visible: boolean, editable: boolean): ResourceScopePermission {
  return { visible, editable, canPublish: editable };
}

function permissionsOf(
  auth: AuthContext,
  target: ResourceAgentTarget | undefined,
  override: boolean,
): ResourcePermissions {
  const company = override || roleIsCompanyAdmin(auth);
  const agent = override || agentCanEdit(auth, target);
  return {
    company: permission(
      override || (!auth.anonymous && auth.companyId?.trim() !== ""),
      company,
    ),
    agent: permission(target !== undefined, agent),
    personal: permission(true, true),
  };
}

function gate(
  allowed: boolean,
  ctx: RequestContext,
  message = "Resource authorization denied.",
): Response | undefined {
  if (allowed) return undefined;
  return ctx.auth.anonymous
    ? errorResponse(401, "UNAUTHORIZED", message)
    : errorResponse(403, "FORBIDDEN", message);
}

function parsePath(
  ctx: RequestContext,
  suffix: "resource" | "promote" = "resource",
): { readonly kind: ManagedResourceKind; readonly scope: ResourceScope; readonly name: string } | undefined {
  const parts = ctx.url.pathname.split("/").filter(Boolean);
  const resourceIndex = parts.lastIndexOf("resources");
  const expected = suffix === "resource" ? resourceIndex + 4 : resourceIndex + 5;
  if (resourceIndex < 0 || parts.length !== expected) return undefined;
  if (suffix === "promote" && parts[resourceIndex + 4] !== "promote") return undefined;
  const kind = kindSchema.safeParse(
    parts[resourceIndex + 1] === "skills" ? "skill" :
      parts[resourceIndex + 1] === "templates" ? "template" : undefined,
  );
  const scope = scopeSchema.safeParse(parts[resourceIndex + 2]);
  const encodedName = parts[resourceIndex + 3];
  if (!kind.success || !scope.success || encodedName === undefined || encodedName.length === 0) {
    return undefined;
  }
  try {
    return { kind: kind.data, scope: scope.data, name: decodeURIComponent(encodedName) };
  } catch {
    return undefined;
  }
}

function operationError(error: unknown): Response {
  if (error instanceof SkillValidationError) return skillValidationResponse(error.report);
  const message = error instanceof Error ? error.message : "Resource operation failed.";
  const status = /already exists|EEXIST/i.test(message)
    ? 409
    : /not configured|not supported|must be|escapes|symbolic link|Resource name|Cover image/i.test(message)
      ? 422
      : 500;
  return errorResponse(
    status,
    status === 409
      ? "RESOURCE_ALREADY_EXISTS"
      : status === 422
        ? "RESOURCE_VALIDATION_FAILED"
        : "RESOURCE_OPERATION_FAILED",
    message,
  );
}

function skillValidationResponse(report: SkillValidationReport): Response {
  const message = report.errors
    .map((item) => `${item.line === undefined ? "" : `第${item.line}行：`}${item.message}`)
    .join(" ");
  return errorResponse(422, "SKILL_VALIDATION_FAILED", `技能校验未通过：${message}`);
}

function skillValidationResult(report: SkillValidationReport): Record<string, unknown> {
  return report.warnings.length === 0
    ? {}
    : { validation: { ok: true, warnings: report.warnings } };
}

function validateSkillInput(input: SkillSubmission): SkillValidationReport | Response {
  const report = validateSkillSubmission(input);
  return report.ok ? report : skillValidationResponse(report);
}

async function readJson(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

function agentIdOf(ctx: RequestContext, body: { readonly agentId?: string } = {}): string | undefined {
  return body.agentId ?? ctx.url.searchParams.get("agent") ?? undefined;
}

function visibleCatalog(
  catalog: ResourceCatalog,
  permissions: ResourcePermissions,
  override: boolean,
  target: ResourceAgentTarget | undefined,
): ResourceCatalog {
  const visible = (scope: ResourceScope): boolean => override || permissions[scope].visible;
  return {
    ...catalog,
    skills: catalog.skills.filter((item) => visible(item.scope)),
    templates: catalog.templates.filter((item) => visible(item.scope)),
    permissions,
    ...(target !== undefined ? { agent: { id: target.id, name: target.name } } : {}),
  };
}

export function createResourceRoutes(opts: ResourceRoutesOptions): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;

  const resolveManager = async (
    ctx: RequestContext,
    scope: ResourceScope,
    agentId: string | undefined,
  ): Promise<{
    readonly manager: ResourceManager;
    readonly target?: ResourceAgentTarget;
  }> => {
    if (scope !== "agent") return { manager: opts.manager };
    if (agentId === undefined || opts.resolveAgent === undefined || opts.managerForAgent === undefined) {
      if (adminPolicy(ctx.auth)) return { manager: opts.manager };
      throw new Error("An already loaded Agent must be selected.");
    }
    const target = await opts.resolveAgent(agentId, ctx.auth);
    if (target === undefined) throw new Error("The selected Agent is not loaded locally.");
    return { manager: opts.managerForAgent(target.root), target };
  };

  const list: RouteHandler = async (ctx): Promise<Response> => {
    try {
      const override = adminPolicy(ctx.auth);
      const agentId = agentIdOf(ctx);
      let target: ResourceAgentTarget | undefined;
      if (agentId !== undefined && opts.resolveAgent !== undefined) {
        target = await opts.resolveAgent(agentId, ctx.auth);
        if (target === undefined) return errorResponse(422, "INVALID_AGENT", "The selected Agent is not loaded locally.");
      }
      const manager = target !== undefined && opts.managerForAgent !== undefined
        ? opts.managerForAgent(target.root)
        : opts.manager;
      const permissions = permissionsOf(ctx.auth, target, override);
      return jsonResponse(
        200,
        visibleCatalog(await manager.list(), permissions, override, target) as unknown as Record<string, unknown>,
      );
    } catch (error) {
      return operationError(error);
    }
  };

  const listAgents: RouteHandler = async (ctx): Promise<Response> => {
    try {
      const agents = opts.listAgents === undefined
        ? []
        : await opts.listAgents(ctx.auth);
      return jsonResponse(200, {
        agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
      });
    } catch (error) {
      return operationError(error);
    }
  };

  const createSkill: RouteHandler = async (ctx) => {
    try {
      const parsed = createSkillSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, parsed.scope, parsed.agentId);
      const perms = permissionsOf(ctx.auth, resolved.target, override)[parsed.scope];
      const denied = gate(override || perms.editable, ctx);
      if (denied !== undefined) return denied;
      const { agentId: _agentId, ...input } = parsed;
      const validation = validateSkillInput(input);
      if (validation instanceof Response) return validation;
      return jsonResponse(201, {
        resource: await resolved.manager.createSkill(input),
        ...skillValidationResult(validation),
      });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid skill request.");
      return operationError(error);
    }
  };

  const createTemplate: RouteHandler = async (ctx) => {
    try {
      const parsed = createTemplateSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, parsed.scope, parsed.agentId);
      const perms = permissionsOf(ctx.auth, resolved.target, override)[parsed.scope];
      const denied = gate(override || perms.editable, ctx);
      if (denied !== undefined) return denied;
      const { agentId: _agentId, ...input } = parsed;
      return jsonResponse(201, { resource: await resolved.manager.createTemplate(input) });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid template request.");
      return operationError(error);
    }
  };

  const read: RouteHandler = async (ctx) => {
    const target = parsePath(ctx);
    if (target === undefined) return errorResponse(400, "INVALID_RESOURCE_PATH", "Invalid resource path.");
    try {
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, target.scope, agentIdOf(ctx));
      const perms = permissionsOf(ctx.auth, resolved.target, override)[target.scope];
      const denied = gate(override || perms.visible, ctx);
      if (denied !== undefined) return denied;
      return jsonResponse(200, { resource: await resolved.manager.read(target.kind, target.scope, target.name) });
    } catch (error) {
      return operationError(error);
    }
  };

  const update: RouteHandler = async (ctx) => {
    const target = parsePath(ctx);
    if (target === undefined) return errorResponse(400, "INVALID_RESOURCE_PATH", "Invalid resource path.");
    try {
      const parsed = updateResourceSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, target.scope, agentIdOf(ctx, parsed));
      const perms = permissionsOf(ctx.auth, resolved.target, override)[target.scope];
      const denied = gate(override || perms.editable, ctx);
      if (denied !== undefined) return denied;
      if (target.kind === "skill") {
        const input = {
          name: target.name,
          title: parsed.title,
          description: parsed.description,
          content: parsed.content,
        };
        const validation = validateSkillInput(input);
        if (validation instanceof Response) return validation;
        return jsonResponse(200, {
          resource: await resolved.manager.createSkill({
            scope: target.scope,
            name: target.name,
            title: parsed.title,
            description: parsed.description,
            content: parsed.content,
            overwrite: true,
          }),
          ...skillValidationResult(validation),
        });
      }
      return jsonResponse(200, {
        resource: await resolved.manager.createTemplate({
          scope: target.scope,
          name: target.name,
          description: parsed.description,
          argumentHint: parsed.argumentHint,
          sourceTitle: parsed.sourceTitle,
          coverImage: parsed.coverImage,
          content: parsed.content,
          overwrite: true,
        }),
      });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid resource request.");
      return operationError(error);
    }
  };

  const promote: RouteHandler = async (ctx) => {
    const source = parsePath(ctx, "promote");
    if (source === undefined) return errorResponse(400, "INVALID_RESOURCE_PATH", "Invalid resource path.");
    try {
      const parsed = promoteSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const from = await resolveManager(ctx, source.scope, parsed.sourceAgentId);
      const to = await resolveManager(ctx, parsed.targetScope, parsed.targetAgentId);
      const permissions = permissionsOf(ctx.auth, to.target, override);
      const sourcePermission = permissionsOf(ctx.auth, from.target, override)[source.scope];
      const targetPermission = permissions[parsed.targetScope];
      const sourceDenied = gate(override || sourcePermission.visible, ctx);
      if (sourceDenied !== undefined) return sourceDenied;
      const targetDenied = gate(override || targetPermission.editable, ctx);
      if (targetDenied !== undefined) return targetDenied;
      const resource = await from.manager.read(source.kind, source.scope, source.name);
      const base = {
        scope: parsed.targetScope,
        name: resource.name,
        ...(resource.title !== undefined ? { title: resource.title } : {}),
        description: resource.description,
        content: resource.content,
        overwrite: parsed.overwrite === true,
      } as const;
      const validation = source.kind === "skill"
        ? validateSkillInput({
            name: base.name,
            title: base.title,
            description: base.description,
            content: base.content,
          })
        : undefined;
      if (validation instanceof Response) return validation;
      const created = source.kind === "skill"
        ? await to.manager.createSkill(base)
        : await to.manager.createTemplate({
            ...base,
            argumentHint: resource.argumentHint,
            sourceTitle: resource.sourceTitle,
            coverImage: resource.coverImage,
          });
      return jsonResponse(201, {
        resource: created,
        from: source.scope,
        to: parsed.targetScope,
        ...(validation === undefined ? {} : skillValidationResult(validation)),
      });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid promotion request.");
      return operationError(error);
    }
  };

  const install: RouteHandler = async (ctx) => {
    try {
      const parsed = packageSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, parsed.scope, parsed.agentId);
      const denied = gate(override || permissionsOf(ctx.auth, resolved.target, override)[parsed.scope].editable, ctx);
      if (denied !== undefined) return denied;
      await resolved.manager.installPackage(parsed.scope, parsed.source);
      return jsonResponse(200, { ok: true, source: parsed.source, scope: parsed.scope });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid package request.");
      return operationError(error);
    }
  };

  const removePackage: RouteHandler = async (ctx) => {
    try {
      const parsed = packageSchema.parse(await readJson(ctx.req));
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, parsed.scope, parsed.agentId);
      const denied = gate(override || permissionsOf(ctx.auth, resolved.target, override)[parsed.scope].editable, ctx);
      if (denied !== undefined) return denied;
      const removed = await resolved.manager.removePackage(parsed.scope, parsed.source);
      return jsonResponse(200, { ok: removed, source: parsed.source, scope: parsed.scope });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) return errorResponse(400, "INVALID_RESOURCE_REQUEST", "Invalid package request.");
      return operationError(error);
    }
  };

  const remove: RouteHandler = async (ctx) => {
    const target = parsePath(ctx);
    if (target === undefined) return errorResponse(400, "INVALID_RESOURCE_PATH", "Invalid resource path.");
    try {
      const override = adminPolicy(ctx.auth);
      const resolved = await resolveManager(ctx, target.scope, agentIdOf(ctx));
      const denied = gate(override || permissionsOf(ctx.auth, resolved.target, override)[target.scope].editable, ctx);
      if (denied !== undefined) return denied;
      await resolved.manager.remove(target.kind, target.scope, target.name);
      return jsonResponse(200, { ok: true });
    } catch (error) {
      return operationError(error);
    }
  };

  return [
    { method: "GET", path: "/resources", handler: list },
    { method: "GET", path: "/resources/agents", handler: listAgents },
    { method: "POST", path: "/resources/skills", handler: createSkill },
    { method: "POST", path: "/resources/templates", handler: createTemplate },
    { method: "POST", path: "/resources/packages/install", handler: install },
    { method: "POST", path: "/resources/packages/remove", handler: removePackage },
    { method: "GET", path: "/resources/skills/:scope/:name", handler: read },
    { method: "GET", path: "/resources/templates/:scope/:name", handler: read },
    { method: "PUT", path: "/resources/skills/:scope/:name", handler: update },
    { method: "PUT", path: "/resources/templates/:scope/:name", handler: update },
    { method: "POST", path: "/resources/skills/:scope/:name/promote", handler: promote },
    { method: "POST", path: "/resources/templates/:scope/:name/promote", handler: promote },
    { method: "DELETE", path: "/resources/skills/:scope/:name", handler: remove },
    { method: "DELETE", path: "/resources/templates/:scope/:name", handler: remove },
  ];
}

/**
 * materials surface — 素材域热态状态面(Wave 5 · G2②,agent 权威)。
 *
 * 单写者(C1-2):UI 只发命令(`surface.run("materials", …)`)并订阅 `surface:materials`
 * 回流,权威快照由本扩展经上游 `createSurface` 写入。MCP 仅投影当前页(≤60 条)短字段到
 * 热态 `library`;大宗素材仍不进快照。R-0b:选中集只存 attachmentId 引用,二进制永不进快照。
 *
 * 属 runtime 层(经 `@blksails/pi-web-tool-kit/runtime` 加载),不得被前端 bundle import——
 * 前端以 `surfaceStateKey("materials")` 字面契约对接。
 */
import {
  createSurface,
  getAttachmentToolContext as defaultGetAttachmentToolContext,
  type CreateSurfaceDeps,
  type PaneExtensionFactory,
  type SurfaceHandle,
} from "@blksails/pi-web-tool-kit/runtime";

/** pi ExtensionAPI(经 PaneExtensionFactory 参数型提取,免直依 pi SDK 包)。 */
type ExtensionAPI = Parameters<PaneExtensionFactory>[0];

export const MATERIALS_DOMAIN = "materials";

export interface MaterialsFilter {
  /** 素材种类过滤(与 assets-list route 的 KINDS 同域)。 */
  readonly kind?: "image" | "video" | "audio";
  /** 库范围:本会话 / 全部。 */
  readonly scope?: "session" | "all";
}

/** 素材目录(小热态:名字与父子关系,不含素材本体)。 */
export interface MaterialsFolder {
  readonly id: string;
  readonly name: string;
  /** 顶层目录无 parentId。 */
  readonly parentId?: string;
}

/** webapp materials_search 的当前页瘦投影；无二进制、无全量库。 */
export interface MaterialsLibraryItem {
  readonly assetId: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta: {
    readonly name?: string;
    readonly materialId: string;
    readonly type?: string;
  };
}

export interface MaterialsLibraryState {
  readonly phase: "idle" | "ready" | "error";
  readonly items: readonly MaterialsLibraryItem[];
  readonly total: number;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface MaterialsState {
  /** 选中素材(attachmentId 引用,整替语义,去重保序)。 */
  readonly selectedIds: readonly string[];
  readonly filter: MaterialsFilter;
  /** 目录树(R-0c:仅结构,素材本体留数据面)。 */
  readonly folders: readonly MaterialsFolder[];
  /** 素材归属:attachmentId → folderId(仅**已分类**者入表,未分类不占位)。 */
  readonly itemFolder: Readonly<Record<string, string>>;
  /**
   * 素材显示名覆盖:attachmentId → name(仅**改过名**者入表)。
   *
   * 素材名的原始来源是数据面(`assets-list` 的 `meta.name`,权威在平台后端),故改名不写数据面,
   * 而在此登记一层热态覆盖 —— UI 显示时优先取它。与 `itemFolder` 同构:只存引用与短字符串,
   * 二进制永不进快照(R-0b)。
   */
  readonly itemName: Readonly<Record<string, string>>;
  /** webapp MCP 当前页只读投影；命令回包不作 UI 权威。 */
  readonly library: MaterialsLibraryState;
}

export function emptyMaterialsState(): MaterialsState {
  return {
    selectedIds: [],
    filter: {},
    folders: [],
    itemFolder: {},
    itemName: {},
    library: { phase: "idle", items: [], total: 0 },
  };
}

const KINDS = new Set(["image", "video", "audio"]);
const SCOPES = new Set(["session", "all"]);
const MAX_FOLDERS = 200;
const MAX_NAME = 64;
/** 素材名上限(对齐源项目输入框的「≤200 字」提示)。 */
const MAX_ITEM_NAME = 200;

function invalidArgs(message: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error: { code: "invalid_args", message } };
}

function notFound(message: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error: { code: "not_found", message } };
}

/** 目录名归一:去首尾空白;空 / 超长 / 非串 → undefined(调用方回 invalid_args)。 */
function normName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s === "" || s.length > MAX_NAME ? undefined : s;
}

/** `id` 是否为 `ancestor` 的自身或后代(移动目录时防环)。 */
function isDescendant(
  folders: readonly MaterialsFolder[],
  id: string,
  ancestor: string,
): boolean {
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = folders.find((f) => f.id === cur)?.parentId;
  }
  return false;
}

/** 目录 id:优先 crypto.randomUUID,无则退化为计数式(仅需进程内唯一)。 */
function newFolderId(existing: readonly MaterialsFolder[]): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `fld_${uuid.slice(0, 8)}`;
  let n = existing.length + 1;
  while (existing.some((f) => f.id === `fld_${n}`)) n += 1;
  return `fld_${n}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function projectLibraryItem(value: unknown): MaterialsLibraryItem | undefined {
  const row = asRecord(value);
  if (row === undefined) return undefined;
  const materialId = String(row.id ?? "").trim();
  if (materialId === "") return undefined;
  const fileUrl =
    typeof row.file_url === "string" ? row.file_url : "";
  const coverUrl =
    typeof row.cover_url === "string" ? row.cover_url : "";
  return {
    assetId: `material:${materialId}`,
    displayUrl: coverUrl || fileUrl,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    meta: {
      materialId,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      ...(typeof row.type === "string" ? { type: row.type } : {}),
    },
  };
}

/**
 * 构造可注入依赖的 materials 装配函数(测试注入 fake getSessionState/registry;
 * 生产缺省取真实 seam,对齐 makeCanvasSurfaceExtension 范式)。
 */
export function makeMaterialsSurfaceExtension(
  deps: CreateSurfaceDeps = {},
): (pi: ExtensionAPI) => SurfaceHandle<MaterialsState> {
  const getAtt =
    deps.getAttachmentToolContext ?? defaultGetAttachmentToolContext;
  const scope = deps.scope;
  return (pi: ExtensionAPI): SurfaceHandle<MaterialsState> => {
    const handle = createSurface<MaterialsState>(
      pi,
      {
        domain: MATERIALS_DOMAIN,
        initialState: emptyMaterialsState(),
        commands: {
          /**
           * webapp MCP → 当前素材页瘦投影。命令只报告数量；UI 一律订阅 library 快照。
           * MCP 缺席/鉴权失败皆落稳定 error 态，不回退伪数据。
           */
          "sync-library": async (args, ctx) => {
            const a = (args ?? {}) as {
              kind?: unknown;
              search?: unknown;
              pageSize?: unknown;
            };
            const kind =
              typeof a.kind === "string" && KINDS.has(a.kind)
                ? a.kind
                : undefined;
            const pageSize =
              typeof a.pageSize === "number" && Number.isInteger(a.pageSize)
                ? Math.min(60, Math.max(1, a.pageSize))
                : 60;
            const call = await ctx.mcp.call({
              serverName: "pi-labs",
              toolName: "materials_search",
              args: {
                ...(kind !== undefined
                  ? { type: kind.toUpperCase() }
                  : {}),
                ...(typeof a.search === "string" && a.search.trim() !== ""
                  ? { search: a.search.trim() }
                  : {}),
                page: 1,
                pageSize,
              },
            });
            if (!call.ok) {
              ctx.setState((s) => ({
                ...s,
                library: {
                  phase: "error",
                  items: [],
                  total: 0,
                  error: call.error,
                },
              }));
              return { ok: false as const, error: call.error };
            }
            const result = call.result;
            if (result.isError === true) {
              const error = {
                code: "mcp_tool_error",
                message: "Materials MCP tool reported an error.",
              };
              ctx.setState((s) => ({
                ...s,
                library: { phase: "error", items: [], total: 0, error },
              }));
              return { ok: false as const, error };
            }
            const structured = asRecord(result.structuredContent);
            const rawItems = Array.isArray(structured?.items)
              ? structured.items
              : [];
            const items = rawItems
              .map(projectLibraryItem)
              .filter((item): item is MaterialsLibraryItem => item !== undefined);
            const total = Number(structured?.total ?? items.length);
            ctx.setState((s) => ({
              ...s,
              library: {
                phase: "ready",
                items,
                total: Number.isFinite(total) ? total : items.length,
              },
            }));
            return { count: items.length };
          },

          /** 整替选中集:{ ids: string[] }。 */
          select: (args, ctx) => {
            const ids = (args as { ids?: unknown } | null)?.ids;
            if (
              !Array.isArray(ids) ||
              ids.some((x) => typeof x !== "string")
            ) {
              return invalidArgs("select 需 { ids: string[] }");
            }
            const unique = [...new Set(ids as string[])];
            ctx.setState((s) => ({ ...s, selectedIds: unique }));
            return { selectedIds: unique };
          },
          /** 整替过滤器:{ kind?, scope? },非法枚举丢弃不入快照。 */
          "set-filter": (args, ctx) => {
            const a = (args ?? {}) as { kind?: unknown; scope?: unknown };
            const filter: MaterialsFilter = {
              ...(typeof a.kind === "string" && KINDS.has(a.kind)
                ? { kind: a.kind as MaterialsFilter["kind"] }
                : {}),
              ...(typeof a.scope === "string" && SCOPES.has(a.scope)
                ? { scope: a.scope as MaterialsFilter["scope"] }
                : {}),
            };
            ctx.setState((s) => ({ ...s, filter }));
            return { filter };
          },

          /**
           * 建目录:{ name, parentId? }。控制面写路径(R-0a 只约束数据面;权威写者恒为 agent)。
           * 名字去重不强制(同名目录合法,如同文件系统的不同路径)。
           */
          "create-folder": (args, ctx) => {
            const a = (args ?? {}) as { name?: unknown; parentId?: unknown };
            const name = normName(a.name);
            if (name === undefined) {
              return invalidArgs(`create-folder 需 { name: 非空字符串(≤${MAX_NAME}) }`);
            }
            const parentId = typeof a.parentId === "string" ? a.parentId : undefined;
            const cur = ctx.get();
            if (cur.folders.length >= MAX_FOLDERS) {
              return invalidArgs(`目录数已达上限 ${MAX_FOLDERS}`);
            }
            if (parentId !== undefined && !cur.folders.some((f) => f.id === parentId)) {
              return notFound(`父目录不存在: ${parentId}`);
            }
            const folder: MaterialsFolder = {
              id: newFolderId(cur.folders),
              name,
              ...(parentId !== undefined ? { parentId } : {}),
            };
            ctx.setState((s) => ({ ...s, folders: [...s.folders, folder] }));
            return { folder };
          },

          /** 改名:{ id, name }。 */
          "rename-folder": (args, ctx) => {
            const a = (args ?? {}) as { id?: unknown; name?: unknown };
            const name = normName(a.name);
            if (typeof a.id !== "string" || name === undefined) {
              return invalidArgs("rename-folder 需 { id: string, name: 非空字符串 }");
            }
            const id = a.id;
            if (!ctx.get().folders.some((f) => f.id === id)) {
              return notFound(`目录不存在: ${id}`);
            }
            ctx.setState((s) => ({
              ...s,
              folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
            }));
            return { id, name };
          },

          /**
           * 移目录:{ id, parentId? }(parentId 省略 = 移到顶层)。
           * 防环:目标父不得是自身或自身后代。
           */
          "move-folder": (args, ctx) => {
            const a = (args ?? {}) as { id?: unknown; parentId?: unknown };
            if (typeof a.id !== "string") return invalidArgs("move-folder 需 { id: string }");
            const id = a.id;
            const parentId = typeof a.parentId === "string" ? a.parentId : undefined;
            const cur = ctx.get();
            if (!cur.folders.some((f) => f.id === id)) return notFound(`目录不存在: ${id}`);
            if (parentId !== undefined) {
              if (!cur.folders.some((f) => f.id === parentId)) {
                return notFound(`父目录不存在: ${parentId}`);
              }
              if (isDescendant(cur.folders, parentId, id)) {
                return invalidArgs("不能移入自身或其后代");
              }
            }
            ctx.setState((s) => ({
              ...s,
              folders: s.folders.map((f) =>
                f.id === id
                  ? { ...f, ...(parentId !== undefined ? { parentId } : { parentId: undefined }) }
                  : f,
              ),
            }));
            return { id, parentId: parentId ?? null };
          },

          /**
           * 删目录:{ id }。连同后代目录一并删,其下素材归属清空(素材本体不动——
           * 权威在数据面,此处只解除分类)。
           */
          "delete-folder": (args, ctx) => {
            const a = (args ?? {}) as { id?: unknown };
            if (typeof a.id !== "string") return invalidArgs("delete-folder 需 { id: string }");
            const id = a.id;
            const cur = ctx.get();
            if (!cur.folders.some((f) => f.id === id)) return notFound(`目录不存在: ${id}`);
            const doomed = new Set(
              cur.folders.filter((f) => isDescendant(cur.folders, f.id, id)).map((f) => f.id),
            );
            ctx.setState((s) => {
              const itemFolder: Record<string, string> = {};
              for (const [att, fid] of Object.entries(s.itemFolder)) {
                if (!doomed.has(fid)) itemFolder[att] = fid;
              }
              return { ...s, folders: s.folders.filter((f) => !doomed.has(f.id)), itemFolder };
            });
            return { removed: [...doomed] };
          },

          /**
           * 素材归类:{ ids: string[], folderId: string | null }(null = 移出目录)。
           * 只写引用(attachmentId → folderId),二进制永不进快照(R-0b)。
           */
          "move-items": (args, ctx) => {
            const a = (args ?? {}) as { ids?: unknown; folderId?: unknown };
            const ids = a.ids;
            if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
              return invalidArgs("move-items 需 { ids: string[] }");
            }
            const folderId =
              a.folderId === null || a.folderId === undefined ? null : a.folderId;
            if (folderId !== null && typeof folderId !== "string") {
              return invalidArgs("move-items 的 folderId 需 string | null");
            }
            const cur = ctx.get();
            if (folderId !== null && !cur.folders.some((f) => f.id === folderId)) {
              return notFound(`目录不存在: ${folderId}`);
            }
            const unique = [...new Set(ids as string[])];
            ctx.setState((s) => {
              const itemFolder = { ...s.itemFolder };
              for (const att of unique) {
                if (folderId === null) delete itemFolder[att];
                else itemFolder[att] = folderId;
              }
              return { ...s, itemFolder };
            });
            return { ids: unique, folderId };
          },

          /**
           * 素材改名:{ id, name }(name 为空串 = 清除覆盖,回落数据面原名)。
           * 只登记热态覆盖名,不写数据面(见 `MaterialsState.itemName`)。
           */
          "rename-item": (args, ctx) => {
            const a = (args ?? {}) as { id?: unknown; name?: unknown };
            if (typeof a.id !== "string" || a.id === "") {
              return invalidArgs("rename-item 需 { id: string }");
            }
            if (typeof a.name !== "string") {
              return invalidArgs("rename-item 需 { name: string }(空串 = 清除覆盖)");
            }
            const id = a.id;
            const name = a.name.trim();
            if (name.length > MAX_ITEM_NAME) {
              return invalidArgs(`素材名过长(≤${MAX_ITEM_NAME})`);
            }
            ctx.setState((s) => {
              const itemName = { ...s.itemName };
              if (name === "") delete itemName[id];
              else itemName[id] = name;
              return { ...s, itemName };
            });
            return { id, name: name === "" ? null : name };
          },
        },
      },
      deps,
    );
    // 轮末收敛(AAS 扳机③,canvas extension 同法):对话流工具可能删/归档素材,致 selectedIds
    // 指向失效附件——agent_end 时经 attachment seam 枚举核对,剔除失效 id 重推快照;
    // seam 不可用或枚举异常静默跳过(留待下一轮末,不影响 agent loop)。
    pi.on("agent_end", () => {
      void (async () => {
        try {
          const att = getAtt(scope);
          if (!att.available) return;
          const live = new Set(
            (await att.listBySession()).map((d) => d.id),
          );
          handle.update((s) => {
            const kept = s.selectedIds.filter((id) => live.has(id));
            return kept.length === s.selectedIds.length
              ? s
              : { ...s, selectedIds: kept };
          });
        } catch {
          // 收敛失败留待下一轮末。
        }
      })();
    });
    return handle;
  };
}

/** 装载形态:`materialsPaneModule.extensions = [materialsSurfaceExtension]`。 */
export const materialsSurfaceExtension = (pi: ExtensionAPI): void => {
  makeMaterialsSurfaceExtension()(pi);
};

/**
 * materials surface — 素材域热态状态面(Wave 5 · G2②,agent 权威)。
 *
 * 单写者(C1-2):UI 只发命令(`surface.run("materials", …)`)并订阅 `surface:materials`
 * 回流,权威快照由本扩展经上游 `createSurface` 写入。R-0c:快照仅热态
 * `{selectedIds, filter}`,大宗素材数据留数据面(assets-list route);R-0b:选中集只存
 * attachmentId 引用,二进制永不进快照。
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

export interface MaterialsState {
  /** 选中素材(attachmentId 引用,整替语义,去重保序)。 */
  readonly selectedIds: readonly string[];
  readonly filter: MaterialsFilter;
}

export function emptyMaterialsState(): MaterialsState {
  return { selectedIds: [], filter: {} };
}

const KINDS = new Set(["image", "video", "audio"]);
const SCOPES = new Set(["session", "all"]);

function invalidArgs(message: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error: { code: "invalid_args", message } };
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

/**
 * Canvas surface 命令处理器(aigc-canvas · Req 2.x / 4.x / 5.x / 7.1)。
 *
 * 全部命令经上游 `createSurface` 的 `SurfaceCtx<GalleryState>` 执行:
 *  - **A 档**(`edit`/`inpaint`/`reference`/`variants`/`outpaint`/`reframe`):`safeParse` args → 在
 *    **子进程内**直调 `runImageTool`(`ext=undefined` + `requiredParams:[]` 安全:附件解析独立于 `ext`,
 *    经 `deps.getCtx` 复用 `SurfaceCtx.attachments`;`ext` 仅用于交互补全)→ 成功映射 `details.assets`
 *    为画廊资产 + 经上游 `setMeta` 写血缘(`derivedFrom`=源 att_,`genParams`=args)+ `ctx.setState`
 *    prepend + 返回 `{ids}`;`details.ok===false`/抛出 → 非抛错 `{ok:false, error:{code}}`(不留半态)。
 *  - **B 档回流** `register`:`resolve` 校验属主 → `setMeta` 写血缘 → `setState` prepend(**不调 provider**)。
 *  - **视图收敛** `sync`:`rebuildGalleryFromAttachments` reconcile。
 *  - **删除** `delete`:`setState` filter 移除。
 *
 * 无二进制进 args / 快照(仅 `att_` 引用 + `runImageTool` 返回的签名 `displayUrl`);血缘存取一律经上游 seam。
 */
import type { SurfaceCommandHandler, SurfaceCtx } from "../../surface/create-surface.js";
import { runImageTool as defaultRunImageTool } from "../run-image-tool.js";
import {
  IMAGE_EDIT_ROUTES,
  IMAGE_EDIT_DEFAULT_MODEL,
  IMAGE_EDIT_MEDIA_FIELDS,
} from "../tools/image-edit.js";
import { rebuildGalleryFromAttachments } from "./hydrate.js";
import {
  DeleteArgsSchema,
  EditArgsSchema,
  InpaintArgsSchema,
  OutpaintArgsSchema,
  ReferenceArgsSchema,
  RegisterArgsSchema,
  ReframeArgsSchema,
  VariantsArgsSchema,
  type CanvasCapability,
  type GalleryAsset,
  type GalleryState,
} from "./schema.js";

/** 命令处理器可注入依赖(测试用;默认取真实 `runImageTool` + 系统时钟)。 */
export interface CanvasCommandDeps {
  /** 图像编辑执行器(默认 `runImageTool`)。 */
  runImageTool?: typeof defaultRunImageTool;
  /** 资产 createdAt 时钟(默认 `() => new Date().toISOString()`)。 */
  now?: () => string;
  /**
   * 能力清单兜底注入(接缝):所有写点优先从 `s.capabilities` 继承,仅当当前快照缺失(冷启/退化)时
   * 才回落此值。装配期 extension 透传其一次生成的 capability;缺省 undefined(纯继承,不引入第二来源)。
   */
  capability?: CanvasCapability;
  /**
   * 插件车道注入的额外命令(canvas-plugins-m3 Req 6.3):按 action 名并入命令表。
   * 合并语义=**重名内置优先**(见 {@link createCanvasCommands}:builtin 展开在 extra 之后覆盖同名键),
   * 使插件无法遮蔽 A 档 / register / sync / delete 的既有行为。
   */
  readonly extraCommands?: Record<string, SurfaceCommandHandler<GalleryState>>;
}

type ExplicitFailure = { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): ExplicitFailure {
  return { ok: false, error: { code, message } };
}

/**
 * A 档:调 `runImageTool` 执行一次图像编辑,映射产物为画廊资产、写血缘、prepend 快照。
 * `details.ok===false` / 未产出 → 显式失败(不留半态)。返回新 att_ id 列表。
 */
async function executeImageEdit(
  ctx: SurfaceCtx<GalleryState>,
  params: Record<string, unknown>,
  lineage: { derivedFrom?: string; genParams: unknown },
  deps: Required<Pick<CanvasCommandDeps, "runImageTool" | "now">> & {
    capability?: CanvasCapability;
  },
): Promise<{ ids: string[] } | ExplicitFailure> {
  // 流式渐进预览(由糊变清)不在此接线:runImageTool 内部经全局 live-preview seam 广播,canvas
  // surface 的 sink 投影进 `livePreview`(见 canvas/extension.ts + surface/live-preview-seam.ts),
  // 对话流 LLM 工具与命令旁路两条路径统一覆盖。故此处 onUpdate 仍为 undefined。
  const result = await deps.runImageTool(params, undefined, undefined, undefined, {
    toolName: "image_edit",
    routes: IMAGE_EDIT_ROUTES,
    defaultModel: IMAGE_EDIT_DEFAULT_MODEL,
    requiredParams: [],
    mediaFields: IMAGE_EDIT_MEDIA_FIELDS,
    deps: { getCtx: () => ctx.attachments },
  });

  const details = result.details;
  if (details === undefined || details.ok === false) {
    const message =
      details !== undefined && details.ok === false ? details.error : "image edit failed";
    return fail("edit_failed", message);
  }

  const createdAt = deps.now();
  const fresh: GalleryAsset[] = details.assets.map((a) => ({
    attachmentId: a.attachmentId,
    displayUrl: a.displayUrl,
    mimeType: a.mimeType,
    name: a.name,
    createdAt,
    origin: "tool-output" as const,
    ...(lineage.derivedFrom !== undefined ? { derivedFrom: lineage.derivedFrom } : {}),
    genParams: lineage.genParams,
  }));

  // 血缘持久:经上游 setMeta seam 写附件不透明扩展 meta(Req 7.1)。
  for (const a of fresh) {
    await ctx.attachments.setMeta(a.attachmentId, {
      ...(lineage.derivedFrom !== undefined ? { derivedFrom: lineage.derivedFrom } : {}),
      genParams: lineage.genParams,
    });
  }

  // 终图落库 → prepend 进画廊(reducer 只留 assets,天然丢弃临时 livePreview,由糊变清收束到最终资产);
  // capabilities 从 s 继承显式保留(写点⑤;漏则每次编辑成功后前端能力清单被清空退回硬编码)。
  ctx.setState((s) => ({
    assets: [...fresh, ...s.assets],
    capabilities: s.capabilities ?? deps.capability,
  }));
  return { ids: fresh.map((a) => a.attachmentId) };
}

/**
 * 构造 Canvas surface 命令表(A 档 + register/sync/delete)。
 *
 * @param deps 可注入依赖(测试用)。
 */
export function createCanvasCommands(
  deps: CanvasCommandDeps = {},
): Record<string, SurfaceCommandHandler<GalleryState>> {
  const resolved = {
    runImageTool: deps.runImageTool ?? defaultRunImageTool,
    now: deps.now ?? ((): string => new Date().toISOString()),
    capability: deps.capability,
  };

  const builtin: Record<string, SurfaceCommandHandler<GalleryState>> = {
    /** 整图指令编辑。 */
    edit: async (args, ctx) => {
      const parsed = EditArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image } = parsed.data;
      return executeImageEdit(ctx, { ...parsed.data }, { derivedFrom: image, genParams: parsed.data }, resolved);
    },

    /** 局部重绘(mask 涂白重绘)。 */
    inpaint: async (args, ctx) => {
      const parsed = InpaintArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image } = parsed.data;
      return executeImageEdit(ctx, { ...parsed.data }, { derivedFrom: image, genParams: parsed.data }, resolved);
    },

    /** 参考图融合。 */
    reference: async (args, ctx) => {
      const parsed = ReferenceArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image } = parsed.data;
      return executeImageEdit(ctx, { ...parsed.data }, { derivedFrom: image, genParams: parsed.data }, resolved);
    },

    /** 扩图(outpaint)。 */
    outpaint: async (args, ctx) => {
      const parsed = OutpaintArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image } = parsed.data;
      return executeImageEdit(ctx, { ...parsed.data }, { derivedFrom: image, genParams: parsed.data }, resolved);
    },

    /** 比例重构(reframe)。 */
    reframe: async (args, ctx) => {
      const parsed = ReframeArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image } = parsed.data;
      return executeImageEdit(ctx, { ...parsed.data }, { derivedFrom: image, genParams: parsed.data }, resolved);
    },

    /** 多变体(可跨多模型):对每个 model 逐一执行并汇总 ids。 */
    variants: async (args, ctx) => {
      const parsed = VariantsArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { image, models, model, ...rest } = parsed.data;
      const modelList = models ?? (model !== undefined ? [model] : [undefined]);
      const ids: string[] = [];
      for (const m of modelList) {
        const params: Record<string, unknown> = { image, ...rest };
        if (m !== undefined) params.model = m;
        const outcome = await executeImageEdit(
          ctx,
          params,
          { derivedFrom: image, genParams: { ...parsed.data, model: m } },
          resolved,
        );
        if ("ok" in outcome && outcome.ok === false) return outcome;
        ids.push(...(outcome as { ids: string[] }).ids);
      }
      return { ids };
    },

    /** B 档回流:登记已落库的客户端产物 att_(不调 provider)。 */
    register: async (args, ctx) => {
      const parsed = RegisterArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { attachmentId, derivedFrom, genParams } = parsed.data;
      // 属主校验(resolve 越权/不存在会抛 → dispatch 归一化 ok:false)。
      const handle = await ctx.attachments.resolve(attachmentId);
      const displayUrl = await handle.url();
      await ctx.attachments.setMeta(attachmentId, {
        ...(derivedFrom !== undefined ? { derivedFrom } : {}),
        genParams,
      });
      const asset: GalleryAsset = {
        attachmentId,
        displayUrl,
        mimeType: handle.meta.mimeType,
        name: handle.meta.name,
        createdAt: handle.meta.createdAt,
        origin: handle.meta.origin,
        ...(derivedFrom !== undefined ? { derivedFrom } : {}),
        genParams,
      };
      ctx.setState((s) => ({
        assets: [asset, ...s.assets.filter((a) => a.attachmentId !== attachmentId)],
        capabilities: s.capabilities ?? resolved.capability, // 写点⑥:register 保留 capabilities。
      }));
      return { ids: [attachmentId] };
    },

    /** 视图收敛:重新枚举 attachment store,reconcile 画廊(收敛触发源 ①,LLM 生成图入画廊)。 */
    sync: async (_args, ctx) => {
      const rebuilt = await rebuildGalleryFromAttachments(ctx.attachments);
      // 全量整替(写点④),但从 s.capabilities 继承保留能力清单——不在此二次生成(权威唯一来源:装配期)。
      ctx.setState((s) => ({ ...rebuilt, capabilities: s.capabilities ?? resolved.capability }));
      return { count: rebuilt.assets.length };
    },

    /** 从快照移除资产(粘性清理由上游 state 桥承担)。 */
    delete: async (args, ctx) => {
      const parsed = DeleteArgsSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_args", parsed.error.message);
      const { attachmentId } = parsed.data;
      ctx.setState((s) => ({
        assets: s.assets.filter((a) => a.attachmentId !== attachmentId),
        capabilities: s.capabilities ?? resolved.capability, // 写点⑥:delete 保留 capabilities。
      }));
      return { deleted: attachmentId };
    },
  };

  // 合并:extra 展开在前、builtin 在后 → **重名内置优先**(插件不得遮蔽 A 档 / register / sync / delete)。
  // 无 logger 接缝,重名覆盖语义以此注释档案化(诊断:重名键的 extra 处理器被 builtin 静默覆盖)。
  return { ...deps.extraCommands, ...builtin };
}

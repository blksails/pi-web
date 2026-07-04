/**
 * `canvasSurfaceExtension` — aigc-canvas 的 agent 侧装配(Req 1.x)。
 *
 * 以 `ExtensionFactory` 形态(对齐 `aigcExtension`)经**上游 `createSurface`** 装配 `domain="canvas"`
 * 的权威 surface:
 *  - `initialState`:空画廊(在函数体内经 `emptyGalleryState()` 构造 → 不跨会话共享引用,Req 1.3);
 *  - `commands`:A 档 + `register`/`sync`/`delete`(见 `commands.ts`);
 *  - `hydrate`:经上游 attachment seam 枚举重建物化视图(见 `hydrate.ts`)。
 *
 * **复用上游 `createSurface`**:不自造 `control:"state"` 帧 / ui-rpc 回流 / 探针 / 注册表(Req 1.2)。
 * 属 runtime 层(含 pi SDK 值导入),仅经 `@blksails/pi-web-tool-kit/runtime` 加载,不进前端 bundle。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createSurface as defaultCreateSurface,
  type CreateSurfaceDeps,
  type SurfaceHandle,
} from "../../surface/create-surface.js";
import { getAttachmentToolContext as defaultGetAttachmentToolContext } from "../../attachment/seam.js";
import { installLivePreviewSink } from "../../surface/live-preview-seam.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import { createCanvasCommands, type CanvasCommandDeps } from "./commands.js";
import { rebuildGalleryFromAttachments } from "./hydrate.js";
import { emptyGalleryState, type GalleryState } from "./schema.js";

export const CANVAS_DOMAIN = "canvas";

/**
 * `hydrate` 在 `createSurface` 装配期(`createAgentSessionRuntime` 内)运行,可能**早于** runner 的
 * `wireAttachmentBridge` 装 attachment seam(装配序:createAgentSessionRuntime → wireAttachmentBridge)。
 * 此时 `getAttachmentToolContext()` 返回 `available:false` 的降级 ctx,枚举会退空。故 seam 未就绪时
 * 短暂轮询等待(bounded;`void assemble()` 非阻塞会话启动),就绪后再枚举重建;始终不可用(无附件能力)
 * → 空画廊(退化,不崩,Req 12.4)。
 */
async function hydrateWhenReady(
  getAtt: (scope?: Record<string, unknown>) => AttachmentToolContext,
  scope: Record<string, unknown> | undefined,
): Promise<GalleryState> {
  const maxTries = 40;
  const stepMs = 25;
  for (let i = 0; i < maxTries; i += 1) {
    const att = getAtt(scope);
    if (att.available) return rebuildGalleryFromAttachments(att);
    await new Promise<void>((r) => setTimeout(r, stepMs));
  }
  return emptyGalleryState();
}

/** 可注入依赖(测试用;默认取真实上游 `createSurface` + attachment seam)。 */
export interface CanvasExtensionDeps {
  /** 上游 surface 门面(默认 `createSurface`);测试注入 spy。 */
  createSurface?: typeof defaultCreateSurface;
  /** 命令处理器依赖(测试注入 fake `runImageTool` / 时钟)。 */
  commandDeps?: CanvasCommandDeps;
  /** 透传给上游 `createSurface` 的依赖(scope / seam 注入)。 */
  surfaceDeps?: CreateSurfaceDeps;
}

/**
 * 构造可注入依赖的 canvas 装配函数(测试用)。
 *
 * @param deps 可注入依赖。
 * @returns `ExtensionFactory`:`(pi) => SurfaceHandle<GalleryState>`。
 */
export function makeCanvasSurfaceExtension(
  deps: CanvasExtensionDeps = {},
): (pi: ExtensionAPI) => SurfaceHandle<GalleryState> {
  const createSurface = deps.createSurface ?? defaultCreateSurface;
  const getAtt = deps.surfaceDeps?.getAttachmentToolContext ?? defaultGetAttachmentToolContext;
  const scope = deps.surfaceDeps?.scope;

  return (pi: ExtensionAPI): SurfaceHandle<GalleryState> => {
    const handle = createSurface<GalleryState>(
      pi,
      {
        domain: CANVAS_DOMAIN,
        initialState: emptyGalleryState(),
        commands: createCanvasCommands(deps.commandDeps),
        hydrate: () => hydrateWhenReady(getAtt, scope),
      },
      deps.surfaceDeps ?? {},
    );
    // 装 live-preview sink:runImageTool 流式(对话流 LLM 工具 或 命令旁路皆经它)出图时经 seam 广播 →
    // 投影进 canvas 临时 `livePreview`(生成中「由糊变清」指示);`null` = 结束清除。
    // ⚠️ 刻意**只取 stage,丢弃 frame.displayUrl(大图 data URI)**:大帧经 fd1 与 pi RPC 并发写会交织
    // 损坏 JSONL 半行被丢(守无二进制帧不变量,见 schema LivePreviewSchema)。完整渐进图由对话流工具卡承载。
    installLivePreviewSink((frame) =>
      handle.update((s) => ({
        ...s,
        livePreview: frame === null ? null : { stage: frame.stage },
      })),
    );
    // 轮末自主收敛(契约 AAS 扳机③;语义与 `sync` 命令一致:全量重建并整替快照,附带清 livePreview
    // 叠层)。此前收敛仅由 UI 画廊在轮末发 `run("sync")`(扳机②)触发——画廊在工作台打开/面板关闭
    // 期间处于卸载态会错过轮末,物化视图停旧(闭环 e2e pre-existing 缺陷)。权威侧收敛不依赖 UI
    // 挂载态;UI 侧 sync 保留为幂等冗余。seam 不可用或重建异常时静默跳过,不影响 agent loop。
    pi.on("agent_end", () => {
      void (async () => {
        try {
          const att = getAtt(scope);
          if (!att.available) return;
          const rebuilt = await rebuildGalleryFromAttachments(att);
          handle.update(() => rebuilt);
        } catch {
          // 收敛失败留待下一轮末或 UI sync 再收敛。
        }
      })();
    });
    return handle;
  };
}

/** canvas surface 扩展工厂(装载:`extensions: [aigcExtension, canvasSurfaceExtension]`)。 */
export const canvasSurfaceExtension = (pi: ExtensionAPI): void => {
  makeCanvasSurfaceExtension()(pi);
};

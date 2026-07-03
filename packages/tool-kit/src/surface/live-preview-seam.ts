/**
 * 进程内「流式渐进预览」seam(live-preview-seam)。
 *
 * 解决跨扩展协调:`runImageTool`(aigcExtension 的 image_generation/image_edit 工具 **或** canvas 命令旁路
 * 都经它)流式出图时,把 partial_images「由糊变清」预览经此 seam 广播;某个 surface(如 aigc-canvas)
 * 装一个 sink,把预览投影到自己的临时 state(canvas 的 `GalleryState.livePreview`),UI 即渐进显示。
 *
 * 走 `globalThis` 单例(与 attachment-seam / session-state-seam / surface-registry 同惯例):runner 子进程内
 * 唯一实例,前端不加载。无 sink 时 `emitLivePreview` 为 no-op(无 canvas 的 agent 零影响)。预览 payload
 * 可含 **data URI**(transient,不落库);持久产物仍只走 att_。
 */

/** 一帧渐进预览;`null` = 生成结束/清除。 */
export interface LivePreviewFrame {
  /** 最新预览图(data URI 或远程 URL)。 */
  displayUrl: string;
  /** 阶段:`partial`=渐进中;`finalizing`=已出终图正在落库。 */
  stage: "partial" | "finalizing";
}

/** sink:surface 装载,把预览投影进自己的 state;`null` 表清除。 */
export type LivePreviewSink = (frame: LivePreviewFrame | null) => void;

const SEAM_KEY = "__piWebLivePreviewSink__";

interface SeamHost {
  [SEAM_KEY]?: LivePreviewSink;
}

function host(): SeamHost {
  return globalThis as unknown as SeamHost;
}

/**
 * 装载预览 sink(canvasSurfaceExtension 等在创建 surface 后调用)。返回卸载函数。
 * 覆盖式:后装的接管(单一活跃 surface 预览目标;多 surface 场景由最后装载者胜出)。
 */
export function installLivePreviewSink(sink: LivePreviewSink): () => void {
  host()[SEAM_KEY] = sink;
  return () => {
    if (host()[SEAM_KEY] === sink) delete host()[SEAM_KEY];
  };
}

/** 广播一帧渐进预览(`null` 清除)。无 sink → no-op。 */
export function emitLivePreview(frame: LivePreviewFrame | null): void {
  const sink = host()[SEAM_KEY];
  if (sink === undefined) return;
  try {
    sink(frame);
  } catch {
    // sink 抛错不应中断生成;best-effort。
  }
}

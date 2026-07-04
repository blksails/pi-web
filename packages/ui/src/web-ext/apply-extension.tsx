/**
 * apply-extension / slot-host — 把 WebExtension 描述符并入宿主(Req 2.x, 3.x, 10.x)。
 *
 * - `applyExtensionRenderers`:把扩展的 Tier2 渲染器注册进 per-session registry,带 extId 命名空间。
 * - `resolveSlot`:取某具名插槽的扩展贡献(ReactNode 或组件),无则 undefined(宿主回退默认)。
 * - `<SlotHost>`:渲染某插槽——扩展贡献优先(error boundary 包裹),否则 fallback。
 *
 * 本模块是隔离单元:不依赖 PiChat;在 chat 内的实际挂载由 pi-chat.tsx(任务 5.2)完成。
 */
import * as React from "react";
import type { SlotKey } from "@blksails/pi-web-protocol";
import type {
  WebExtension,
  SlotContribution,
  WebExtStateAccess,
  WebExtSurfaceAccess,
  ConversationAccess,
} from "@blksails/pi-web-kit";
import type {
  RendererRegistry,
  ToolRenderer,
  DataPartRenderer,
} from "../registry/renderer-registry.js";
import { ExtErrorBoundary } from "./ext-error-boundary.js";

/** 把扩展 Tier2 渲染器注册进 registry(extId 命名空间)。返回卸载函数。 */
export function applyExtensionRenderers(
  registry: RendererRegistry,
  ext: WebExtension,
): () => void {
  const extId = ext.manifestId;
  // web-kit 渲染器与 registry 渲染器结构同形(ComponentType<{part,message}>)。
  const tools = (ext.renderers?.tools ?? {}) as Record<string, ToolRenderer>;
  const dataParts = (ext.renderers?.dataParts ?? {}) as Record<
    string,
    DataPartRenderer
  >;
  for (const [name, comp] of Object.entries(tools)) {
    registry.registerToolRenderer(name, comp, extId);
  }
  for (const [type, comp] of Object.entries(dataParts)) {
    registry.registerDataPartRenderer(type, comp, extId);
  }
  return () => registry.clearExtension(extId);
}

/** 取某插槽的扩展贡献(无则 undefined)。 */
export function resolveSlot(
  ext: WebExtension | undefined,
  slot: SlotKey,
): SlotContribution | undefined {
  return ext?.slots?.[slot];
}

/**
 * 通用附件上传接入(领域无关,像 state / surface 一样由宿主经 prop 注入)。签名对齐 react
 * `uploadAttachment` / `useAttachments`;slot 组件(如 Canvas B 档)据此把客户端产物落 `att_`。
 */
export type SlotUploadFn = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ attachment: { id: string }; displayUrl: string }>;

function renderContribution(
  contribution: SlotContribution,
  extId: string,
  state: WebExtStateAccess | undefined,
  surface: WebExtSurfaceAccess | undefined,
  upload: SlotUploadFn | undefined,
  baseUrl: string | undefined,
  sessionId: string | undefined,
  syncSignal: unknown,
  onSubmitPrompt: ((text: string) => void) | undefined,
  livePreviewImage: string | undefined,
  conversation: ConversationAccess | undefined,
): React.ReactNode {
  // 组件(函数)→ 实例化并传 extId(+ 可选 state / surface / 附件上传接入 / 轮末同步信号 / 会话能力);
  // 否则按 ReactNode 直接渲染。
  // 经 prop 注入(非 React context):webext 是独立打包的 bundle,context 身份不跨 bundle 共享,
  // 故沿用既有「slot 收 extId / contribution 收 rpc」的形参注入范式(state-injection-bridge Req 7 /
  // agent-authoritative-surface)。
  if (typeof contribution === "function") {
    const Comp = contribution as React.ComponentType<{
      extId: string;
      state?: WebExtStateAccess;
      surface?: WebExtSurfaceAccess;
      upload?: SlotUploadFn;
      baseUrl?: string;
      sessionId?: string;
      syncSignal?: unknown;
      onSubmitPrompt?: (text: string) => void;
      livePreviewImage?: string;
      conversation?: ConversationAccess;
    }>;
    return (
      <Comp
        extId={extId}
        state={state}
        surface={surface}
        upload={upload}
        baseUrl={baseUrl}
        sessionId={sessionId}
        syncSignal={syncSignal}
        {...(onSubmitPrompt !== undefined ? { onSubmitPrompt } : {})}
        {...(livePreviewImage !== undefined ? { livePreviewImage } : {})}
        {...(conversation !== undefined ? { conversation } : {})}
      />
    );
  }
  return contribution;
}

export interface SlotHostProps {
  readonly ext: WebExtension | undefined;
  readonly slot: SlotKey;
  /** 扩展未声明该插槽时的默认内容。 */
  readonly fallback?: React.ReactNode;
  readonly onError?: (error: Error) => void;
  /** 共享状态接入(state-injection-bridge);宿主提供,经 prop 透给 slot 组件。 */
  readonly state?: WebExtStateAccess;
  /** 权威 surface 接入(agent-authoritative-surface);宿主提供,经 prop 透给 slot 组件。 */
  readonly surface?: WebExtSurfaceAccess;
  /** 通用附件上传接入(B 档客户端产物落 att_);宿主提供,经 prop 透给 slot 组件。 */
  readonly upload?: SlotUploadFn;
  /** http-api 基址(如 `/api`),附件上传所需。 */
  readonly baseUrl?: string;
  /** 目标会话 id,附件上传写路径门控。 */
  readonly sessionId?: string;
  /**
   * 轮末 idle 边沿信号(值变化即触发 slot 组件重同步);宿主在每轮结束 bump。
   * Canvas 面板据此在 LLM 生图后 `run("sync")` 重建物化视图,否则画廊要等下次重连才 hydrate。
   */
  readonly syncSignal?: unknown;
  /**
   * 经宿主 Prompt 通道发送一条用户消息(进对话流/LLM;canvas 生成走对话即用此接缝,
   * 由 LLM 调 image_edit 等工具执行 —— 操作天然回流对话历史)。
   *
   * @deprecated 使用 `conversation.submitUserMessage`;此裸回调为过渡别名,行为与之完全一致,
   * 保留至少一个大版本后移除(契约 §4.2 命名事故修复,Req 6.2/6.3)。
   */
  readonly onSubmitPrompt?: (text: string) => void;
  /**
   * 宿主转发的当前轮流式图像预览(data URI/URL);图已随对话流到浏览器,slot(如 Canvas)零成本
   * 复用做「由糊变清」渐进展示,规避 surface 大帧经 fd1 损坏。
   */
  readonly livePreviewImage?: string;
  /**
   * 会话能力对象(契约 §4.2;与 state / surface / upload 同族的能力对象注入)。承载「经宿主
   * Prompt 通道提交用户消息」这一能力,取代事件回调形态的 `onSubmitPrompt`。宿主领域无关:只搬运
   * text 与显式 attachmentIds,不解析、不改写内容。宿主提供,经 prop 透给 slot 组件。
   */
  readonly conversation?: ConversationAccess;
}

/** 渲染具名插槽:扩展贡献优先(error boundary 隔离),否则 fallback。 */
export function SlotHost({
  ext,
  slot,
  fallback,
  onError,
  state,
  surface,
  upload,
  baseUrl,
  sessionId,
  syncSignal,
  onSubmitPrompt,
  livePreviewImage,
  conversation,
}: SlotHostProps): React.ReactNode {
  const contribution = resolveSlot(ext, slot);
  if (contribution === undefined) return fallback ?? null;
  return (
    <ExtErrorBoundary
      fallback={fallback ?? null}
      {...(onError !== undefined ? { onError } : {})}
    >
      {renderContribution(
        contribution,
        ext?.manifestId ?? "",
        state,
        surface,
        upload,
        baseUrl,
        sessionId,
        syncSignal,
        onSubmitPrompt,
        livePreviewImage,
        conversation,
      )}
    </ExtErrorBoundary>
  );
}

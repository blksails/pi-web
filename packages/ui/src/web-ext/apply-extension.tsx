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
import type { SlotKey } from "@pi-web/protocol";
import type { WebExtension, SlotContribution } from "@pi-web/web-kit";
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

function renderContribution(
  contribution: SlotContribution,
  extId: string,
): React.ReactNode {
  // 组件(函数)→ 实例化并传 extId;否则按 ReactNode 直接渲染。
  if (typeof contribution === "function") {
    const Comp = contribution as React.ComponentType<{ extId: string }>;
    return <Comp extId={extId} />;
  }
  return contribution;
}

export interface SlotHostProps {
  readonly ext: WebExtension | undefined;
  readonly slot: SlotKey;
  /** 扩展未声明该插槽时的默认内容。 */
  readonly fallback?: React.ReactNode;
  readonly onError?: (error: Error) => void;
}

/** 渲染具名插槽:扩展贡献优先(error boundary 隔离),否则 fallback。 */
export function SlotHost({
  ext,
  slot,
  fallback,
  onError,
}: SlotHostProps): React.ReactNode {
  const contribution = resolveSlot(ext, slot);
  if (contribution === undefined) return fallback ?? null;
  return (
    <ExtErrorBoundary
      fallback={fallback ?? null}
      {...(onError !== undefined ? { onError } : {})}
    >
      {renderContribution(contribution, ext?.manifestId ?? "")}
    </ExtErrorBoundary>
  );
}

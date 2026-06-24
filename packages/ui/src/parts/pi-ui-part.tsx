/**
 * PiUiPart — `data-pi-ui` 的 DataPartRenderer(server-driven UI 入口)。
 *
 * 把 agent 声明的 UiSpec 渲染为 UI,按信任模型分派:
 *   - kind:"builtin"  ► defaultUiComponentRegistry 解析组件名;命中渲染、未命中占位回退。
 *   - kind:"sandbox"  ► SandboxRenderer 受限解释器渲染节点树。
 *
 * 纵深防御:即便传输层已校验,渲染前再 `UiSpecSchema.safeParse` 一次,使前端独立成立
 * 安全/形状不变量;解析失败渲染可读回退而非抛错。
 *
 * 模块加载即把内置组件 seed 到默认单例,实现 agent 零配置(无需宿主手动注册)。
 */
import * as React from "react";
import { UiSpecSchema } from "@blksails/protocol";
import type { DataPartRenderer } from "../registry/renderer-registry.js";
import { defaultUiComponentRegistry } from "../components/ui-component-registry.js";
import { registerBuiltinUiComponents } from "../components/builtin-components.js";
import { SandboxRenderer } from "../components/sandbox-renderer.js";

// 副作用:内置组件 seed(幂等,覆盖语义)。PiUiPart 被 pi-chat 引用,故不被 tree-shake。
registerBuiltinUiComponents(defaultUiComponentRegistry);

/** 可读回退(解析失败 / 组件未注册):主题化、不抛错、不渲染任意内容。 */
function UiFallback({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--muted-foreground))]"
      data-pi-ui-fallback
    >
      {message}
    </div>
  );
}

export const PiUiPart: DataPartRenderer = ({ part }) => {
  const data = "data" in part ? part.data : undefined;
  const parsed = UiSpecSchema.safeParse(data);
  if (!parsed.success) {
    return <UiFallback message="无法解析 UI 规格(data-pi-ui)" />;
  }
  const spec = parsed.data;

  let body: React.ReactNode;
  if (spec.kind === "builtin") {
    const Comp = defaultUiComponentRegistry.resolveUiComponent(spec.component);
    body =
      Comp === undefined ? (
        <UiFallback message={`未注册的内置组件:${spec.component}`} />
      ) : (
        <Comp props={spec.props ?? {}} />
      );
  } else {
    body = <SandboxRenderer node={spec.root} />;
  }

  return (
    <div className="space-y-1" data-pi-ui-part={spec.kind}>
      {spec.title !== undefined ? (
        <div className="text-sm font-medium text-[hsl(var(--foreground))]">
          {spec.title}
        </div>
      ) : null}
      {body}
    </div>
  );
};

/**
 * apply-settings-widgets — 面⑦ per-source settings 动态控件装载侧咬合(spec
 * source-settings-and-slots,任务 7.1;Requirements 5.3, 5.4, 5.5)。
 *
 * webext 描述符(`@blksails/pi-web-kit` `WebExtension.settingsWidgets`,`settingsWidgets`
 * capability)携带的组件是窄接口(`SettingsWidgetProps`:value/onChange/sourceKey/
 * fieldKey/disabled/baseUrl/sessionId),与宿主 `FieldRenderer` 分派用的 `FieldProps`
 * (descriptor/path/errors/registry 等宿主内部字段)不同形——本模块是唯一的适配层:
 * 把每个 `SettingsWidgetComponent` 包一层 `FieldRendererComponent` 适配器,只透传窄
 * 接口需要的字段,再经 `registerSourceFieldRenderer(sourceKey, widgetKey, adapter)`
 * 并入该 source 的 scoped field registry。`baseUrl`/`sessionId` 在**注册时**(而非渲染时)
 * 经闭包捕获注入——避免为此改动 `FieldProps`/`SchemaForm` 的公共签名(两者是宿主设置面板
 * 通用渲染链的稳定契约,不为单个 capability 增字段)。
 *
 * source 切换/卸载/webext 重载(reloadNonce bump)时调用方须以新 `applySettingsWidgets`
 * 调用覆盖(整段覆盖同 `registerSourceFieldRenderer` 的覆盖语义)或调用其返回的
 * `dispose()` 整体回收(`unregisterSourceFieldRenderers`),不留孤儿 widget 渲染器。
 */
import * as React from "react";
import type { WebExtension, SettingsWidgetComponent } from "@blksails/pi-web-kit";
import type { FieldProps, FieldRendererComponent } from "./field-registry.js";
import { registerSourceFieldRenderer, unregisterSourceFieldRenderers } from "./field-registry.js";

/** 装载侧上下文:注册时经闭包注入给每个 widget(不经 `FieldProps` 透传)。 */
export interface SettingsWidgetLoadContext {
  /** http-api 基址(如 `/api`);widget 据此调用本模块 agent-declared-routes 端点。 */
  readonly baseUrl?: string;
  /** 当前会话 id;缺省(如源选择阶段尚无 session)时 widget 应自行降级。 */
  readonly sessionId?: string;
}

/** 把窄接口 `SettingsWidgetComponent` 适配为宿主 `FieldRendererComponent`。 */
function toFieldRenderer(
  Widget: SettingsWidgetComponent,
  ctx: SettingsWidgetLoadContext,
): FieldRendererComponent {
  function SettingsWidgetAdapter(props: FieldProps): React.JSX.Element {
    return React.createElement(Widget, {
      value: props.value,
      onChange: props.onChange,
      sourceKey: props.sourceKey ?? "",
      fieldKey: props.descriptor.key,
      disabled: props.disabled,
      baseUrl: ctx.baseUrl,
      sessionId: ctx.sessionId,
    });
  }
  SettingsWidgetAdapter.displayName = `SettingsWidgetAdapter(${Widget.displayName ?? Widget.name ?? "widget"})`;
  return SettingsWidgetAdapter;
}

/**
 * 把某 webext 描述符的 `settingsWidgets` 并入 `sourceKey` 的 scoped field registry。
 * `ext`/`ext.settingsWidgets` 为 `undefined`(webext 未装载/无该能力)时是 no-op(该
 * source 的字段沿宿主既有降级路径走只读 JSON,Req 5.5)。
 *
 * 返回回收函数(回收整个 `sourceKey` scope,与 `unregisterSourceFieldRenderers` 同义)。
 */
export function applySettingsWidgets(
  sourceKey: string,
  ext: WebExtension | undefined,
  ctx: SettingsWidgetLoadContext = {},
): () => void {
  const widgets = ext?.settingsWidgets;
  if (widgets !== undefined) {
    for (const [widgetKey, Widget] of Object.entries(widgets)) {
      if (Widget === undefined) continue;
      registerSourceFieldRenderer(sourceKey, widgetKey, toFieldRenderer(Widget, ctx));
    }
  }
  return () => unregisterSourceFieldRenderers(sourceKey);
}

/**
 * `applySettingsWidgets` 的 React 生命周期封装:`sourceKey`/`ext`/`baseUrl`/`sessionId`
 * 任一变化即重新装载(先前注册整段回收再重注册);`sourceKey` 为 `undefined` 或空串时
 * 视为未激活,不装载。组件卸载时回收,不留孤儿注册。
 */
export function useSourceSettingsWidgets(
  sourceKey: string | undefined,
  ext: WebExtension | undefined,
  ctx: SettingsWidgetLoadContext = {},
): void {
  const { baseUrl, sessionId } = ctx;
  React.useEffect(() => {
    if (sourceKey === undefined || sourceKey.length === 0) return;
    const dispose = applySettingsWidgets(sourceKey, ext, { baseUrl, sessionId });
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ext 是对象引用,调用方按 useMemo/webext 装载生命周期保证稳定性(同 useRuntimeWebext 先例)。
  }, [sourceKey, ext, baseUrl, sessionId]);
}

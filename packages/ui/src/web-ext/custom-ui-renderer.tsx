/**
 * custom-ui-renderer — ctx.ui.custom 的前端注册式渲染(unified-command-result-layer 任务 5.2)。
 *
 * `ctx.ui.custom` 的工厂函数不可跨进程序列化,故 web 侧改用**声明式描述**(注册名 + props,
 * CustomUiPayload)。宿主预注册「注册名 → React 组件」,渲染时按名查表:命中则渲染,未命中
 * 安全降级为占位(不崩,Req 6.2)。pi SDK 在 rpc-mode 把 custom 桥成帧/part 是外部依赖
 * (Req 6.3/6.5);本渲染器与接收路径解耦,既可由命令结果帧驱动,也可作 data-part 渲染。
 */
import * as React from "react";
import {
  CustomUiPayloadSchema,
  type CustomUiPayload,
} from "@blksails/pi-web-protocol";

export type CustomUiComponent = React.ComponentType<{ readonly props: unknown }>;

const registry = new Map<string, CustomUiComponent>();

/** 注册一个自定义组件(注册名 → 组件)。 */
export function registerCustomUi(name: string, component: CustomUiComponent): void {
  registry.set(name, component);
}

/** 查注册组件(测试/渲染用)。 */
export function getCustomUi(name: string): CustomUiComponent | undefined {
  return registry.get(name);
}

/** 按 CustomUiPayload 渲染:命中注册名则渲染组件,否则降级占位。 */
export function CustomUiRenderer({
  payload,
}: {
  readonly payload: CustomUiPayload;
}): React.JSX.Element {
  const Component = registry.get(payload.component);
  if (Component === undefined) {
    return (
      <div
        data-pi-custom-ui-fallback=""
        data-pi-custom-ui-name={payload.component}
        className="text-xs opacity-60"
      >
        未注册的自定义组件: {payload.component}
      </div>
    );
  }
  return (
    <div data-pi-custom-ui="" data-pi-custom-ui-name={payload.component}>
      <Component props={payload.props} />
    </div>
  );
}

/**
 * data-part 适配器:把 `data-pi-custom-ui` part 的 data 解析为 CustomUiPayload 并渲染。
 * 经 `registry.registerDataPartRenderer("data-pi-custom-ui", CustomUiDataPart)` 挂载,
 * 即可让工具/桥接以 data-part 推送自定义渲染(声明式接收路径,Req 6.3 兜底)。
 */
export function CustomUiDataPart({
  part,
}: {
  readonly part: { readonly data?: unknown };
}): React.JSX.Element | null {
  const parsed = CustomUiPayloadSchema.safeParse(part.data);
  if (!parsed.success) return null;
  return <CustomUiRenderer payload={parsed.data} />;
}

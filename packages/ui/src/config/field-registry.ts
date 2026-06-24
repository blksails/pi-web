/**
 * field-registry — 字段渲染器注册表(注册 / 解析 / 默认回退 / 覆盖语义)。
 *
 * 复刻 `renderer-registry` 语义:`<FieldRenderer>` 调用 `resolveFieldRenderer`,
 * 先按字段键(fieldKey)覆盖、再按 kind 默认回退;命中返回组件,未命中返回 undefined
 * (由调用方回退内置默认控件)。模块级单例供宿主在挂载前注册;`createFieldRegistry()`
 * 工厂供测试隔离。
 */
import type { ComponentType } from "react";
import type { FieldDescriptor, FieldKind } from "@blksails/protocol";

/** 字段控件统一 props。 */
export interface FieldProps<V = unknown> {
  readonly descriptor: FieldDescriptor;
  readonly value: V;
  readonly onChange: (next: V) => void;
  /** 自根起的字段路径(用于在 errors 表中按点路径取本字段错误)。 */
  readonly path: readonly string[];
  /** 点路径 → 错误消息。 */
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  /** 当前生效的字段注册表(容器字段须透传给嵌套渲染,以保留宿主的覆盖)。 */
  readonly registry?: FieldRegistry;
}

export type FieldRendererComponent = ComponentType<FieldProps>;

export interface FieldRegistry {
  /** 按字段键覆盖(最高优先)。 */
  registerByKey(fieldKey: string, component: FieldRendererComponent): void;
  /** 按 kind 覆盖默认控件。 */
  registerByKind(kind: FieldKind, component: FieldRendererComponent): void;
  /** 解析:先 fieldKey 覆盖、再 widget、再 kind;未命中返回 undefined。 */
  resolve(descriptor: FieldDescriptor): FieldRendererComponent | undefined;
  reset(): void;
}

export function createFieldRegistry(): FieldRegistry {
  const byKey = new Map<string, FieldRendererComponent>();
  const byKind = new Map<string, FieldRendererComponent>();

  return {
    registerByKey(fieldKey, component): void {
      byKey.set(fieldKey, component);
    },
    registerByKind(kind, component): void {
      byKind.set(kind, component);
    },
    resolve(descriptor): FieldRendererComponent | undefined {
      return (
        byKey.get(descriptor.key) ??
        (descriptor.widget !== undefined ? byKey.get(descriptor.widget) : undefined) ??
        byKind.get(descriptor.kind)
      );
    },
    reset(): void {
      byKey.clear();
      byKind.clear();
    },
  };
}

/** 模块级单例,供宿主直接注册自定义字段控件。 */
export const defaultFieldRegistry: FieldRegistry = createFieldRegistry();

export function registerFieldRendererByKey(
  fieldKey: string,
  component: FieldRendererComponent,
): void {
  defaultFieldRegistry.registerByKey(fieldKey, component);
}

export function registerFieldRendererByKind(
  kind: FieldKind,
  component: FieldRendererComponent,
): void {
  defaultFieldRegistry.registerByKind(kind, component);
}

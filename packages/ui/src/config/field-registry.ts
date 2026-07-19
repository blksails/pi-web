/**
 * field-registry — 字段渲染器注册表(注册 / 解析 / 默认回退 / 覆盖语义)。
 *
 * 复刻 `renderer-registry` 语义:`<FieldRenderer>` 调用 `resolveFieldRenderer`,
 * 先按字段键(fieldKey)覆盖、再按 kind 默认回退;命中返回组件,未命中返回 undefined
 * (由调用方回退内置默认控件)。模块级单例供宿主在挂载前注册;`createFieldRegistry()`
 * 工厂供测试隔离。
 *
 * 另加一层 per-source scoped 注册表(`SourceFieldRegistry`):供 agent-source 的
 * webext 声明 `settingsWidgets` 动态控件时按 sourceKey 隔离注册,查找顺序
 * per-source → 全局(`FieldRenderer` 先查 scoped 命中,未命中再走既有三级解析);
 * source 切换/卸载经 `unregisterSource` 整体回收,不污染全局注册表与其它 source。
 */
import type { ComponentType } from "react";
import type { FieldDescriptor, FieldKind } from "@blksails/pi-web-protocol";

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
  /**
   * 当前表单所属 source 的稳定 key(per-source scoped field registry 用;
   * 容器字段须透传给嵌套渲染)。未设置时不查 scoped 注册表,行为与既有全局解析一致。
   */
  readonly sourceKey?: string;
  /**
   * 文件名 → 服务端已解析的原始 JSON Schema(仅扩展配置域的 configFiles 控件用)。
   * 控件据此优先采用服务端结果(免客户端远端拉取);其余字段忽略。
   */
  readonly fileSchemas?: Record<string, unknown>;
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

/**
 * per-source scoped 字段渲染器注册表。
 *
 * 按 sourceKey 隔离一份 fieldKey/widget → 组件的映射(不含 kind 级默认回退,
 * kind 级默认仍由全局 `FieldRegistry`/内置 DEFAULTS 承担)。source 切换/卸载
 * 时经 `unregisterSource(sourceKey)` 整段回收,不影响其它 source 与全局注册表。
 */
export interface SourceFieldRegistry {
  /** 为 sourceKey 注册一个字段控件(按 fieldKey 或 widget 键命中)。 */
  register(sourceKey: string, fieldKey: string, component: FieldRendererComponent): void;
  /** 解析:仅在该 sourceKey 的作用域内按 fieldKey 优先、widget 次之查找;未命中或该 source 无注册返回 undefined。 */
  resolve(sourceKey: string, descriptor: FieldDescriptor): FieldRendererComponent | undefined;
  /** 回收某 source 的全部 scoped 注册(切源/卸载时调用)。 */
  unregisterSource(sourceKey: string): void;
  reset(): void;
}

export function createSourceFieldRegistry(): SourceFieldRegistry {
  const scopes = new Map<string, Map<string, FieldRendererComponent>>();

  return {
    register(sourceKey, fieldKey, component): void {
      let scope = scopes.get(sourceKey);
      if (scope === undefined) {
        scope = new Map();
        scopes.set(sourceKey, scope);
      }
      scope.set(fieldKey, component);
    },
    resolve(sourceKey, descriptor): FieldRendererComponent | undefined {
      const scope = scopes.get(sourceKey);
      if (scope === undefined) return undefined;
      return (
        scope.get(descriptor.key) ??
        (descriptor.widget !== undefined ? scope.get(descriptor.widget) : undefined)
      );
    },
    unregisterSource(sourceKey): void {
      scopes.delete(sourceKey);
    },
    reset(): void {
      scopes.clear();
    },
  };
}

/** 模块级单例,供宿主为已激活的 source 注册/回收其 scoped 字段控件。 */
export const defaultSourceFieldRegistry: SourceFieldRegistry = createSourceFieldRegistry();

export function registerSourceFieldRenderer(
  sourceKey: string,
  fieldKey: string,
  component: FieldRendererComponent,
): void {
  defaultSourceFieldRegistry.register(sourceKey, fieldKey, component);
}

/** source 切换/卸载时调用,回收该 source 的全部 scoped 字段控件注册。 */
export function unregisterSourceFieldRenderers(sourceKey: string): void {
  defaultSourceFieldRegistry.unregisterSource(sourceKey);
}

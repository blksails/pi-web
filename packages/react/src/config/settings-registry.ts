/**
 * settings-registry — 设置面板注册表(注册 / 解析 / 列举 + 默认回退 / 覆盖)。
 *
 * 复刻 renderer-registry 语义:模块级单例供宿主在挂载前注册面板;`createSettingsRegistry()`
 * 工厂供测试隔离。新增配置域 = 注册一个面板,设置外壳零改动即纳入。
 */
import type { FormSchema } from "@blksails/pi-web-protocol";
import type { FormValues } from "./use-schema-form.js";

/**
 * 加载结果:可为裸表单值(现状),或 `{ values, fileSchemas }` 包裹形态。
 * fileSchemas = 文件名 → 服务端已解析的原始 JSON Schema(供 configFiles 控件优先采用,
 * 免客户端远端拉取);仅扩展配置域会回传。判别安全:各配置域值对象均无顶层 `values` 键。
 */
export interface ConfigDomainData {
  readonly values: FormValues;
  readonly fileSchemas?: Record<string, unknown>;
}

/** 面板的数据源(与持久化端点解耦,便于测试注入 mock)。 */
export interface ConfigDomainIO {
  /** 取当前值(secret 已掩码);可附带 fileSchemas。 */
  readonly load: () => Promise<FormValues | ConfigDomainData>;
  /** 写回合法值。 */
  readonly save: (values: FormValues) => Promise<void>;
}

/**
 * 归一化 load() 结果为 `{ values, fileSchemas }`。裸表单值(任意配置域值对象)无 fileSchemas。
 * 判别为 wrapper 的条件:顶层键**恰好**是 `values`(+可选 `fileSchemas`)且 `values` 为对象——
 * 避免把恰含名为 `values` 的 provider 的 auth 域裸值误判为 wrapper(否则丢其余 provider)。
 */
export function normalizeConfigDomainData(
  result: FormValues | ConfigDomainData,
): ConfigDomainData {
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    "values" in result &&
    typeof (result as ConfigDomainData).values === "object" &&
    (result as ConfigDomainData).values !== null &&
    Object.keys(result).every((k) => k === "values" || k === "fileSchemas")
  ) {
    return result as ConfigDomainData;
  }
  return { values: result as FormValues };
}

export interface SettingsPanelDescriptor extends ConfigDomainIO {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly icon?: string;
  readonly formSchema: FormSchema;
  /** 校验器(通常由 zodValidator(域 schema) 提供)。 */
  readonly validate?: (values: FormValues) =>
    | { ok: true; values: FormValues }
    | { ok: false; errors: Readonly<Record<string, string>> };
  /**
   * 分组(可选):同 `group` 的多个面板合并为左侧**一个**菜单项,进入后以 Tab 切换。
   * 缺省时该面板自成一组(行为不变)。典型:沙箱/扩展的「全局」「项目」两面板同组。
   */
  readonly group?: string;
  /** 该组在左侧菜单的标题(同组取任一非空者)。缺省回退到面板 title。 */
  readonly groupTitle?: string;
  /** 该组在左侧菜单的排序(同组取任一)。缺省回退到面板 order。 */
  readonly groupOrder?: number;
  /** 组内 Tab 标签(如「全局」「项目」)。 */
  readonly tabLabel?: string;
  /** 组内 Tab 排序。 */
  readonly tabOrder?: number;
}

export interface SettingsRegistry {
  registerPanel(panel: SettingsPanelDescriptor): void;
  /** 撤销登记(源切换/去激活时回收动态面板,不留孤儿条目)。未登记的 id 静默忽略。 */
  unregisterPanel(id: string): void;
  resolvePanel(id: string): SettingsPanelDescriptor | undefined;
  /** 按 order(缺省置后)、再按注册序返回。 */
  listPanels(): SettingsPanelDescriptor[];
  reset(): void;
}

export function createSettingsRegistry(): SettingsRegistry {
  const panels = new Map<string, SettingsPanelDescriptor>();
  const order: string[] = [];

  return {
    registerPanel(panel): void {
      if (!panels.has(panel.id)) order.push(panel.id);
      panels.set(panel.id, panel); // 覆盖语义:最后写入胜出。
    },
    unregisterPanel(id): void {
      if (!panels.has(id)) return;
      panels.delete(id);
      const idx = order.indexOf(id);
      if (idx !== -1) order.splice(idx, 1);
    },
    resolvePanel(id): SettingsPanelDescriptor | undefined {
      return panels.get(id);
    },
    listPanels(): SettingsPanelDescriptor[] {
      return order
        .map((id) => panels.get(id))
        .filter((p): p is SettingsPanelDescriptor => p !== undefined)
        .map((p, i) => ({ p, i }))
        .sort((a, b) => {
          const ao = a.p.order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.p.order ?? Number.MAX_SAFE_INTEGER;
          return ao === bo ? a.i - b.i : ao - bo;
        })
        .map(({ p }) => p);
    },
    reset(): void {
      panels.clear();
      order.length = 0;
    },
  };
}

/** 模块级单例,供宿主直接注册。 */
export const defaultSettingsRegistry: SettingsRegistry = createSettingsRegistry();

export function registerSettingsPanel(panel: SettingsPanelDescriptor): void {
  defaultSettingsRegistry.registerPanel(panel);
}

export function unregisterSettingsPanel(id: string): void {
  defaultSettingsRegistry.unregisterPanel(id);
}

/**
 * register-source-settings-panel — per-source 设置面板动态登记(面⑦,任务 4.1)。
 *
 * spec: source-settings-and-slots;design.md「面⑦ UI 挂载点」;Requirements 5.1, 5.2, 5.6。
 *
 * 复刻 `lib/settings/register-panels.ts` 的 `registerMcpPanelIfInstalled`(异步 GET 探测→
 * 命中则登记→由调用方 bump 触发 `<SettingsShell>` 重渲染)模式,但参数化到任意
 * `sourceKey`,并补上 `registerMcpPanelIfInstalled` 没有的「回收」半边——mcp 面板是全局单例
 * 永不撤销,per-source 面板必须在切源/去激活时撤销,不留孤儿菜单项(Req 5.6)。
 *
 * GET `/api/config/source/:sourceKey` 契约(任务 2.2,`source-settings-routes.ts`):
 * - 200 → `{ schema: FormSchema, values(masked), scope, title?, icon? }`
 * - 404 → 未知 sourceKey 或该 source 未声明 settings
 * - 门控关闭(`PI_WEB_SOURCE_SETTINGS_DISABLED=1`)→ 统一 404,不泄露端点存在性
 * 两种 404 语义相同:"没有可用配置面",均静默跳过、不登记面板(Req 5.1 末句)。
 *
 * **面板标题取值优先级(任务 5.1 附带修复,Req 5.2)**:响应体的清单级 `title`
 * (即 `pi-web.json#settings.title`,由 `ResolvedSourceSettings.title` 经端点透出)优先;
 * 缺省时回退 `schema.title`(FormSchema 自身可选标题——作者只写表单标题未写清单标题时的
 * 兼容路径);两者皆缺时回退调用方传入的 `fallbackTitle`(通常是 source 名)。`icon` 同款
 * 优先级:`opts.icon`(调用方显式覆盖)> 响应体清单 `icon`。
 */
import * as React from "react";
import type { FormSchema } from "@blksails/pi-web-protocol";
import {
  defaultSettingsRegistry,
  normalizeConfigDomainData,
  type ConfigDomainData,
  type SettingsRegistry,
} from "./settings-registry.js";
import type { FormValues } from "./use-schema-form.js";

export interface RegisterSourceSettingsPanelOptions {
  /** REST 基址,默认 "/api"(同 `makeConfigDomainIO`)。 */
  readonly baseUrl?: string;
  /** 注入 fetch(测试用),默认全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
  /** 注入注册表(测试隔离用),默认模块级单例。 */
  readonly registry?: SettingsRegistry;
  /** 面板菜单项图标,缺省不设。 */
  readonly icon?: string;
  /** 面板排序,缺省置后(与既有 P0 域面板并存时排在其后)。 */
  readonly order?: number;
  /**
   * 显式作用域(`?scope=`),缺省不传——服务端用该 source 清单声明的 scope。
   * `scope:"project"` 且服务端无 `defaultCwd` 时必须配 `cwd`。
   */
  readonly scope?: "source" | "project";
  /** `scope:"project"` 时的项目根(`?cwd=`)。 */
  readonly cwd?: string;
}

/** per-source 面板 id:与内置域面板(`"auth"`/`"settings"`/…)天然不冲突的稳定前缀。 */
export function sourceSettingsPanelId(sourceKey: string): string {
  return `source-settings:${sourceKey}`;
}

function buildUrl(sourceKey: string, opts: RegisterSourceSettingsPanelOptions): string {
  const baseUrl = opts.baseUrl ?? "/api";
  const url = `${baseUrl}/config/source/${encodeURIComponent(sourceKey)}`;
  const params = new URLSearchParams();
  if (opts.scope !== undefined) params.set("scope", opts.scope);
  if (opts.cwd !== undefined && opts.cwd.length > 0) params.set("cwd", opts.cwd);
  const qs = params.toString();
  return qs.length > 0 ? `${url}?${qs}` : url;
}

interface SourceSettingsGetResponse {
  readonly schema?: FormSchema;
  readonly values?: FormValues;
  /** 清单 `settings.title`(Req 5.2,任务 5.1 附带修复)。 */
  readonly title?: string;
  /** 清单 `settings.icon`。 */
  readonly icon?: string;
}

/**
 * 探测并登记某 source 的设置面板(幂等:按 id 覆盖,可安全重复调用)。
 *
 * - GET 命中(200 且带 `schema`)→ 登记面板(load/save 均指向同一端点),返回 `true`。
 * - GET 未命中(404/门控关闭/网络错误/响应无 `schema`)→ 不登记,返回 `false`,静默跳过
 *   (Req 5.1「无 settings source 不登记」)。
 *
 * 调用方需在返回 `true` 后自行触发一次重渲染(与 `registerMcpPanelIfInstalled` 同款
 * 「探测完成后 bump」协议),使 `<SettingsShell>`(每次渲染重读注册表)纳入该面板。
 */
export async function registerSourceSettingsPanel(
  sourceKey: string,
  fallbackTitle: string,
  opts: RegisterSourceSettingsPanelOptions = {},
): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? fetch;
  const registry = opts.registry ?? defaultSettingsRegistry;
  const url = buildUrl(sourceKey, opts);

  let schema: FormSchema;
  let manifestTitle: string | undefined;
  let manifestIcon: string | undefined;
  try {
    const res = await doFetch(url, { method: "GET" });
    if (!res.ok) return false;
    const json = (await res.json()) as SourceSettingsGetResponse;
    if (json.schema === undefined) return false;
    schema = json.schema;
    manifestTitle = json.title;
    manifestIcon = json.icon;
  } catch {
    return false;
  }

  registry.registerPanel({
    id: sourceSettingsPanelId(sourceKey),
    title: manifestTitle ?? schema.title ?? fallbackTitle,
    icon: opts.icon ?? manifestIcon,
    order: opts.order,
    formSchema: schema,
    // 无 validate:结构性校验已在服务端 PUT 路径执行(400 + 结构化错误体);客户端仅转发。
    load: async (): Promise<ConfigDomainData> => {
      const loadRes = await doFetch(url, { method: "GET" });
      if (!loadRes.ok) throw new Error(`加载设置失败(${loadRes.status})`);
      const loadJson = (await loadRes.json()) as SourceSettingsGetResponse;
      return normalizeConfigDomainData({ values: loadJson.values ?? {} });
    },
    save: async (values): Promise<void> => {
      const saveRes = await doFetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!saveRes.ok) {
        let msg = `保存设置失败(${saveRes.status})`;
        try {
          const j = (await saveRes.json()) as { error?: { message?: string } };
          if (j.error?.message !== undefined) msg = j.error.message;
        } catch {
          /* 忽略解析失败 */
        }
        throw new Error(msg);
      }
    },
  });
  return true;
}

/**
 * 撤销登记某 source 的设置面板(切源/去激活回收,Req 5.6)。未登记的 sourceKey 静默忽略,
 * 不留孤儿面板。
 */
export function unregisterSourceSettingsPanel(
  sourceKey: string,
  registry: SettingsRegistry = defaultSettingsRegistry,
): void {
  registry.unregisterPanel(sourceSettingsPanelId(sourceKey));
}

export interface UseSourceSettingsPanelOptions extends RegisterSourceSettingsPanelOptions {
  /**
   * 登记/回收状态变化后的回调(登记成功、或本 hook 卸载/切源触发回收后各调用一次)。
   * `<SettingsShell>` 不订阅注册表变化,宿主需借此 bump 自身重渲染
   * (与 `registerMcpPanelIfInstalled` 调用侧的 `bump()` 同一协议)。
   */
  readonly onChange?: () => void;
}

/**
 * source 激活时探测并登记其设置面板,`sourceKey`/`fallbackTitle` 变化(切源)或本 hook
 * 卸载(去激活)时撤销登记——把 `registerSourceSettingsPanel` / `unregisterSourceSettingsPanel`
 * 接进标准 React 生命周期(Req 5.1 激活登记、5.6 切源回收)。
 *
 * `sourceKey` 为 `undefined`(未选中任何 source)时不探测、不登记,等价于「去激活」。
 * 竞态保护同 `useRuntimeWebext`(`lib/app/webext-load-client.ts`):`cancelled` 标志防止
 * 快速切源时旧请求的迟到响应登记出「幽灵」面板。
 */
export function useSourceSettingsPanel(
  sourceKey: string | undefined,
  fallbackTitle: string,
  opts: UseSourceSettingsPanelOptions = {},
): void {
  const { onChange, ...registerOpts } = opts;
  const registry = registerOpts.registry ?? defaultSettingsRegistry;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    if (sourceKey === undefined || sourceKey.length === 0) return;
    let cancelled = false;
    void registerSourceSettingsPanel(sourceKey, fallbackTitle, registerOpts).then((added) => {
      if (!cancelled && added) onChangeRef.current?.();
    });
    return () => {
      cancelled = true;
      const wasRegistered = registry.resolvePanel(sourceSettingsPanelId(sourceKey)) !== undefined;
      unregisterSourceSettingsPanel(sourceKey, registry);
      if (wasRegistered) onChangeRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registerOpts 逐字段稳定性由调用方保证,同 useRuntimeWebext 先例只依赖标量。
  }, [sourceKey, fallbackTitle]);
}

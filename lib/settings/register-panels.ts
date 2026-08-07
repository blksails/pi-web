/**
 * 向设置注册表登记配置面板(auth / settings / sandbox 全局 / sandbox 项目)。
 *
 * 新增配置域 = 在此追加一次 registerSettingsPanel(...),设置外壳(<SettingsShell>)零改动。
 * 面板的 load/save 经 /api/config/...(makeConfigDomainIO 或自定义 IO);校验用各域 zod schema。
 */
import * as React from "react";
import {
  registerSettingsPanel,
  makeConfigDomainIO,
  zodValidator,
  secretAwareValidator,
  type ConfigDomainIO,
  type ConfigDomainData,
  type FormValues,
} from "@blksails/pi-web-react";
import {
  authFormSchema,
  authConfigSchema,
  settingsFormSchema,
  settingsConfigSchema,
  sandboxFormSchema,
  sandboxConfigSchema,
  extensionsFormSchema,
  extensionsConfigSchema,
  loggingFormSchema,
  loggingConfigSchema,
  aigcFormSchema,
  cloudFormSchema,
  cloudConfigSchema,
  aigcConfigSchema,
  mcpFormSchema,
  mcpConfigSchema,
  providersFormSchema,
  createProvidersConfigSchema,
} from "@blksails/pi-web-protocol";
import {
  registerFieldRendererByKey,
  ExtensionsKvField,
  ConfigFilesField,
  ModelSelectField,
  NamespaceTogglesField,
  AigcModelTogglesField,
  VisionModelSelectField,
} from "@blksails/pi-web-ui";
import { ResourceSettingsPanel } from "@/components/resource-manager";

let registered = false;

const resourcePanelFormSchema = { domain: "resources", fields: [] } as const;
const resourcePanelIO: ConfigDomainIO = {
  load: async () => ({}),
  save: async () => undefined,
};

/** 经给定 URL 读写表单值的通用 IO(自定义路径,非 /config/:domain)。 */
function makeUrlIO(url: string, label: string): ConfigDomainIO {
  return {
    load: async (): Promise<ConfigDomainData> => {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`加载${label}失败(${res.status})`);
      const json = (await res.json()) as {
        values?: FormValues;
        fileSchemas?: Record<string, unknown>;
      };
      // 透传服务端解析的 fileSchemas(扩展配置域),供 configFiles 控件优先采用。
      return { values: json.values ?? {}, fileSchemas: json.fileSchemas };
    },
    save: async (values): Promise<void> => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        let msg = `保存${label}失败(${res.status})`;
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          if (j.error?.message !== undefined) msg = j.error.message;
        } catch {
          /* 忽略解析失败 */
        }
        throw new Error(msg);
      }
    },
  };
}

/** 项目沙箱配置 IO(方案 B):`<cwd>/.pi/sandbox.json`,经 `/api/config/sandbox/project`。 */
function makeSandboxProjectIO(): ConfigDomainIO {
  return makeUrlIO("/api/config/sandbox/project", "项目沙箱配置");
}

/** 幂等注册(注册表按 id 覆盖,重复调用安全)。 */
export function registerConfigPanels(): void {
  if (registered) return;
  registered = true;

  registerSettingsPanel({
    id: "auth",
    title: "凭证",
    order: 1,
    icon: "key-round",
    formSchema: authFormSchema,
    // auth 含 secret 字段(apiKey),表单值是 SecretWrite/掩码对象,故用 secret 感知校验器。
    validate: secretAwareValidator(authConfigSchema),
    ...makeConfigDomainIO("auth"),
  });

  registerSettingsPanel({
    id: "settings",
    title: "通用",
    order: 2,
    icon: "settings",
    formSchema: settingsFormSchema,
    validate: zodValidator(settingsConfigSchema),
    ...makeConfigDomainIO("settings"),
  });

  // 沙箱:合并为一个「沙箱」菜单项,进入后用 Tab 切「全局 / 项目」。
  // - 全局(方案 A):写 `~/.pi/agent/sandbox.json`,对所有 agent 生效。
  registerSettingsPanel({
    id: "sandbox",
    title: "沙箱",
    group: "sandbox",
    groupTitle: "沙箱",
    groupOrder: 3,
    tabLabel: "全局",
    tabOrder: 1,
    icon: "shield",
    formSchema: sandboxFormSchema,
    validate: zodValidator(sandboxConfigSchema),
    ...makeConfigDomainIO("sandbox"),
  });

  // - 项目(方案 B):写所服务项目的 `<cwd>/.pi/sandbox.json`,叠加在全局之上。
  registerSettingsPanel({
    id: "sandbox-project",
    title: "沙箱",
    group: "sandbox",
    groupTitle: "沙箱",
    groupOrder: 3,
    tabLabel: "项目",
    tabOrder: 2,
    icon: "shield-half",
    formSchema: { ...sandboxFormSchema, domain: "sandbox-project" },
    validate: zodValidator(sandboxConfigSchema),
    ...makeSandboxProjectIO(),
  });

  // 自定义控件:per-扩展 KV 编辑器 + 独立配置文件(原始 JSON)编辑器。
  registerFieldRendererByKey("extensionsKv", ExtensionsKvField);
  registerFieldRendererByKey("configFiles", ConfigFilesField);
  // settings 的 provider/model 可搜索下拉(选项来自 GET /api/config/models)。
  registerFieldRendererByKey("providerSelect", ModelSelectField);
  registerFieldRendererByKey("modelSelect", ModelSelectField);
  // logging 命名空间开关自定义控件（logNamespaceToggles widget 键）。
  registerFieldRendererByKey("logNamespaceToggles", NamespaceTogglesField);
  // AIGC 图像「模型开关」自定义控件（aigcModelToggles widget 键;清单来自 GET /api/aigc/models）。
  registerFieldRendererByKey("aigcModelToggles", AigcModelTogglesField);
  // 视觉模型选择(visionModelSelect widget;清单来自 GET /api/vision/models)。
  // ★ 该字段双向:用户在此设,`image_vision` 也会在用户于弹层选过后写回同一字段。
  registerFieldRendererByKey("visionModelSelect", VisionModelSelectField);

  // 扩展:一个「扩展」菜单项 + 全局/项目 Tab。固定区=Slash 命令可用性,KV 区=per-扩展参数。
  // - 全局:写 `~/.pi/agent/settings.json`。
  registerSettingsPanel({
    id: "extensions",
    title: "扩展",
    group: "extensions",
    groupTitle: "扩展",
    groupOrder: 4,
    tabLabel: "全局",
    tabOrder: 1,
    icon: "puzzle",
    formSchema: extensionsFormSchema,
    validate: zodValidator(extensionsConfigSchema),
    ...makeUrlIO("/api/config/extensions/global", "扩展配置"),
  });

  // - 项目:写所服务项目的 `<cwd>/.pi/settings.json`。
  registerSettingsPanel({
    id: "extensions-project",
    title: "扩展",
    group: "extensions",
    groupTitle: "扩展",
    groupOrder: 4,
    tabLabel: "项目",
    tabOrder: 2,
    icon: "puzzle",
    formSchema: { ...extensionsFormSchema, domain: "extensions-project" },
    validate: zodValidator(extensionsConfigSchema),
    ...makeUrlIO("/api/config/extensions/project", "项目扩展配置"),
  });

  // 日志:写 `~/.pi/agent/logging.json`，控制日志开关/级别/命名空间/面板可见性。
  registerSettingsPanel({
    id: "logging",
    title: "日志",
    order: 5,
    icon: "terminal",
    formSchema: loggingFormSchema,
    validate: zodValidator(loggingConfigSchema),
    ...makeConfigDomainIO("logging"),
  });

  // 云端接入(desktop-cloud-login Req 8):写 `~/.pi/agent/cloud.json`。
  // ★ 之所以需要这个面板:云端地址此前只能来自环境变量,而打包的桌面版拿不到环境变量
  //   —— 壳不转发、Finder 双击无 shell 环境、`.env` 落在会被 GC 的运行时目录。
  //   实测后果是双击打开后 /api/auth/me 返回 404、登录入口根本不渲染。
  // ★ 配置在**装配期**读一次(handler 单例 pin 在 globalThis),故改完须重启应用;
  //   该提示写在字段 description 里(cloud.ts),缺它用户会以为功能坏了。
  registerSettingsPanel({
    id: "cloud",
    title: "云端",
    order: 10,
    icon: "cloud",
    formSchema: cloudFormSchema,
    validate: zodValidator(cloudConfigSchema),
    ...makeConfigDomainIO("cloud"),
  });

  // AIGC 图像工具(aigc-tool-settings):写 `~/.pi/agent/aigc.json`,含「模型开关」(被禁模型清单)
  // 与「提示词优化」开关。aigcExtension 装配期读取,关模型在下一次会话/重载后生效。
  registerSettingsPanel({
    id: "aigc",
    title: "AIGC 图像",
    order: 6,
    icon: "image",
    formSchema: aigcFormSchema,
    validate: zodValidator(aigcConfigSchema),
    ...makeConfigDomainIO("aigc"),
  });

  // 内置 MCP 客户端(builtin-mcp-client,Req 5.2):**常驻登记** —— 不再以「是否装了
  // pi-mcp-adapter」为可见条件(MCP 已是一等公民)。表单 IR 来自 protocol 侧单一事实源,
  // 用 objectList + variants 表达「server 列表 + 按传输切换字段集」。
  registerSettingsPanel({
    id: "mcp",
    title: "MCP",
    order: 7,
    icon: "plug",
    formSchema: mcpFormSchema,
    validate: zodValidator(mcpConfigSchema),
    ...makeUrlIO("/api/config/mcp", "MCP 配置"),
  });

  // 原生 Skills / Prompt Templates 与 MCP 同级；每个面板内部再切公司、Agent、个人。
  // 自定义视图不走通用配置表单，故不会再出现独立的「pi 资源管理」页。
  registerSettingsPanel({
    id: "skills",
    title: "Skills",
    order: 8,
    icon: "sparkles",
    formSchema: resourcePanelFormSchema,
    ...resourcePanelIO,
    customView: () => React.createElement(ResourceSettingsPanel, { kind: "skill" }),
  });
  registerSettingsPanel({
    id: "templates",
    title: "提示词模板",
    order: 9,
    icon: "layout-template",
    formSchema: resourcePanelFormSchema,
    ...resourcePanelIO,
    customView: () => React.createElement(ResourceSettingsPanel, { kind: "template" }),
  });

  // 自定义 provider(multi-gateway-providers 任务 5.4;Req 7.1, 11.7):写
  // `<agentDir>/providers.json`,经通用 /config/:domain(不像 mcp 那样需要独立探测端点)。
  // ★ 保留名冲突校验(Req 7.6)在此处**故意**用空集构造 —— 真实保留名清单
  // (`RESERVED_PROVIDER_IDS`)住在 `@blksails/pi-web-core`,而本文件是浏览器 bundle 的一部分
  // (被 `src/routes/settings.tsx` 这类 client 组件 import);全仓没有任何 `src/`/`lib/` 下的
  // 客户端代码引入过 core,不应由本任务开这个口子。空集不影响正确性:标识重复检测(Req 7.6
  // 的另一半)仍在本地生效;保留名冲突这半条由**服务端**(`config-routes.ts` 注入真实
  // `RESERVED_PROVIDER_IDS`)权威把关 —— 提交后端会返回 422,`saveError` 会呈现给用户,
  // 仍落在"保存时报错"内(只是校验时机从"提交前"退到"提交回执"),不构成静默放行。
  // 含 secret(apiKey,嵌在 objectList 条目内)故用 secretAwareValidator。
  registerSettingsPanel({
    id: "providers",
    title: "Provider",
    order: 11,
    icon: "server",
    formSchema: providersFormSchema,
    validate: secretAwareValidator(createProvidersConfigSchema(new Set<string>())),
    ...makeConfigDomainIO("providers"),
  });
}

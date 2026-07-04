/**
 * 向设置注册表登记配置面板(auth / settings / sandbox 全局 / sandbox 项目)。
 *
 * 新增配置域 = 在此追加一次 registerSettingsPanel(...),设置外壳(<SettingsShell>)零改动。
 * 面板的 load/save 经 /api/config/...(makeConfigDomainIO 或自定义 IO);校验用各域 zod schema。
 */
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
  aigcConfigSchema,
  type FormSchema,
} from "@blksails/pi-web-protocol";
import {
  registerFieldRendererByKey,
  ExtensionsKvField,
  ConfigFilesField,
  ModelSelectField,
  NamespaceTogglesField,
  AigcModelTogglesField,
} from "@blksails/pi-web-ui";

let registered = false;

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
}

/** 独立「MCP」面板的表单:单个 configFiles 字段,复用扩展独立配置文件的结构化渲染编辑 mcp.json。 */
const mcpFormSchema: FormSchema = {
  domain: "mcp",
  title: "MCP",
  fields: [
    {
      key: "files",
      kind: "record",
      label: "MCP 配置 (mcp.json)",
      description: "pi-mcp-adapter 的服务器与全局设置(原始 JSON 编辑)。",
      required: false,
      widget: "configFiles",
    },
  ],
};

let mcpRegistered = false;

/**
 * 「装了 pi-mcp-adapter 才出现」门控:异步探测 /api/config/mcp 的 installed,
 * 已安装则登记独立「MCP」面板(幂等)。返回是否登记。需调用方在完成后触发一次重渲染,
 * 使 <SettingsShell>(每次渲染重读 listPanels)纳入该面板。
 */
export async function registerMcpPanelIfInstalled(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (mcpRegistered) return true;
  try {
    const res = await fetchImpl("/api/config/mcp", { method: "GET" });
    if (!res.ok) return false;
    const json = (await res.json()) as { installed?: boolean };
    if (json.installed !== true) return false;
  } catch {
    return false;
  }
  registerSettingsPanel({
    id: "mcp",
    title: "MCP",
    order: 6,
    icon: "plug",
    formSchema: mcpFormSchema,
    ...makeUrlIO("/api/config/mcp", "MCP 配置"),
  });
  mcpRegistered = true;
  return true;
}

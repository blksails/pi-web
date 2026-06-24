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
} from "@blksails/pi-web-protocol";
import {
  registerFieldRendererByKey,
  ExtensionsKvField,
  ConfigFilesField,
  ModelSelectField,
} from "@blksails/pi-web-ui";

let registered = false;

/** 经给定 URL 读写表单值的通用 IO(自定义路径,非 /config/:domain)。 */
function makeUrlIO(url: string, label: string): ConfigDomainIO {
  return {
    load: async (): Promise<FormValues> => {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`加载${label}失败(${res.status})`);
      const json = (await res.json()) as { values?: FormValues };
      return json.values ?? {};
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
}

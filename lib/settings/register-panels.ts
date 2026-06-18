/**
 * 向设置注册表登记 P0 配置面板(auth / settings)。
 *
 * 新增配置域 = 在此追加一次 registerSettingsPanel(...),设置外壳(<SettingsShell>)零改动。
 * 面板的 load/save 经 /api/config/:domain(makeConfigDomainIO);校验用各域 zod schema。
 */
import {
  registerSettingsPanel,
  makeConfigDomainIO,
  zodValidator,
  secretAwareValidator,
} from "@pi-web/react";
import {
  authFormSchema,
  authConfigSchema,
  settingsFormSchema,
  settingsConfigSchema,
} from "@pi-web/protocol";

let registered = false;

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
}

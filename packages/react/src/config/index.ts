/**
 * @pi-web/react — config 子面(配置表单状态 + 设置面板注册表 + 域 IO)。
 */
export {
  useSchemaForm,
  zodValidator,
  type FormValues,
  type ValidationResult,
  type Validator,
  type ZodLike,
  type UseSchemaFormOptions,
  type UseSchemaFormResult,
} from "./use-schema-form.js";
export {
  createSettingsRegistry,
  defaultSettingsRegistry,
  registerSettingsPanel,
  type SettingsRegistry,
  type SettingsPanelDescriptor,
  type ConfigDomainIO,
} from "./settings-registry.js";
export {
  makeConfigDomainIO,
  useConfigDomain,
  type MakeConfigDomainIOOptions,
  type UseConfigDomainResult,
} from "./use-config-domain.js";

/**
 * 宿主关切的默认配置域(spec: host-contract-ports,任务 5.3;Req 7.3/7.4)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6 语义 2/3。
 *
 * ★ 默认集**恰为**四个:`auth` / `settings` / `sandbox` / `logging`。
 * `aigc` **不在**其中——它是**工具领域**的配置(AIGC 图像工具),属 agent source 的扩展
 * 能力,由 source 侧自行注册。把它默认注册进来,等于让宿主替某个具体工具表态,正是本
 * spec 要消除的领域泄漏。此处若要加域,判据只有一条:它是否是**宿主**(而非某个工具)
 * 运行所必需的。
 *
 * 与既有 `CONFIG_FORM_SCHEMAS` / `DOMAIN_SCHEMAS` **并存不接线**(Req 10.4):既有
 * `/config/:domain` 路由行为完全不变,本模块只是同一批 schema 的注册表侧视图,故直接
 * 复用 protocol 的既有 zod 与表单 IR,不另抄一份(抄一份必然漂移)。
 */
import {
  authConfigSchema,
  authFormSchema,
  loggingConfigSchema,
  loggingFormSchema,
  sandboxConfigSchema,
  sandboxFormSchema,
  settingsConfigSchema,
  settingsFormSchema,
} from "@blksails/pi-web-protocol";
import type { ConfigDomainDescriptor, ConfigDomainRegistry } from "./types.js";

/** 宿主关切域,按注册顺序排列。 */
const HOST_CONFIG_DOMAINS: readonly ConfigDomainDescriptor[] = [
  { id: "auth", schema: authConfigSchema, formSchema: authFormSchema },
  { id: "settings", schema: settingsConfigSchema, formSchema: settingsFormSchema },
  { id: "sandbox", schema: sandboxConfigSchema, formSchema: sandboxFormSchema },
  { id: "logging", schema: loggingConfigSchema, formSchema: loggingFormSchema },
];

/**
 * 把宿主关切域注册进 `registry`;不含任何工具领域的域。
 *
 * 若注册表里已存在同 id 的域,按 Req 7.2 抛 `duplicate` 而非覆盖——宿主默认集**不享有**
 * 覆盖特权,否则「先注册者胜」这条不变式就有了一个隐藏的例外。
 */
export function registerHostConfigDomains(registry: ConfigDomainRegistry): void {
  for (const descriptor of HOST_CONFIG_DOMAINS) {
    registry.register(descriptor);
  }
}

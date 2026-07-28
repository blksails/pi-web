/**
 * web-ext 契约 — WebExtension manifest(agent source `.pi/web` 的可序列化清单)。
 *
 * 由作者侧 `pi-web build` 产出。宿主加载前据此做安全门校验(SRI/签名/版本)。
 * 纯数据 + zod,不依赖 React(运行时携带组件的描述符在 `@blksails/pi-web-kit`)。
 *
 * 两类形态:
 *   - 代码扩展:含 `entry`(预构建 ESM)+ `integrity`(entry 的 SRI)。
 *   - 纯声明扩展(Tier 5 零代码):可省略 `entry`/`integrity`,仅靠 `web.config` 声明。
 */
import { z } from "zod";
import { WebExtConfigSchema } from "./config.js";

/** 扩展能力声明(供宿主与门控按需启用)。 */
export const WebExtensionCapabilitySchema = z.enum([
  "slots",
  "renderers",
  "contributions",
  "artifact",
  "config",
  /**
   * 面⑦ per-source settings 动态控件供给方(spec source-settings-and-slots,任务 7.1)。
   * 声明本能力的 webext 可在其运行时描述符(`@blksails/pi-web-kit` WebExtension)携带
   * `settingsWidgets`,由宿主装载后并入该 source 的 per-source scoped field registry
   * (`registerSourceFieldRenderer`),供设置面板 schema 字段 `widget:"<key>"` 命中渲染。
   */
  "settingsWidgets",
]);
export type WebExtensionCapability = z.infer<
  typeof WebExtensionCapabilitySchema
>;

/**
 * 该 webext 贡献的一个**隔离 pane**(声明式,供隔离宿主静态读取)。
 *
 * 为何进 manifest:同源宿主可以从 entry 的运行时描述符里拿到 `PanesHost definition`,但**隔离
 * 宿主拿不到** —— 它只能读 `manifest.json`(entry 要在 opaque-origin iframe 里才跑得起来,而
 * 决定「开几个 iframe、各自 paneId 与授权是什么」恰恰发生在那之前)。缺了这一段,隔离宿主只能
 * 猜一个 pane,多域 webext 就被压成单 tab —— 那正是 pi-clouds cloud 此前的形态。
 *
 * `capabilities` 与 panes-kit `PaneCapabilities` 同形(此处不 import panes-kit:protocol 是纯数据
 * 层,不依赖 UI 包);隔离宿主据此逐 pane 下发 grants,不是整个扩展一份。
 */
export const WebExtPaneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  capabilities: z
    .object({
      routes: z
        .array(z.object({ name: z.string().min(1), methods: z.array(z.enum(["GET", "POST"])) }))
        .optional(),
      surfaceKeys: z.array(z.string().min(1)).optional(),
      surfaceCommands: z
        .array(z.object({ domain: z.string().min(1), actions: z.array(z.string().min(1)) }))
        .optional(),
      attachments: z.enum(["none", "read", "read-write"]).optional(),
      conversation: z.enum(["none", "submit"]).optional(),
    })
    .optional(),
});
export type WebExtPane = z.infer<typeof WebExtPaneSchema>;

/**
 * WebExtension 清单。`id` 唯一(CSS/registry 命名空间根);`targetApiVersion` 为
 * 兼容的 `@blksails/pi-web-kit` semver range。entry 存在则 integrity 必填(加载前校验完整性)。
 */
export const WebExtensionManifestSchema = z
  .object({
    id: z.string().min(1),
    targetApiVersion: z.string().min(1),
    entry: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    integrity: z.string().min(1).optional(),
    signature: z.string().min(1).optional(),
    capabilities: z.array(WebExtensionCapabilitySchema).optional(),
    /**
     * 本扩展贡献的隔离 pane 清单(见 {@link WebExtPaneSchema})。隔离宿主据此**逐 pane**
     * 开 iframe 并下发 grants;同源宿主忽略之(它从运行时描述符拿同一批信息)。
     */
    panes: z.array(WebExtPaneSchema).optional(),
    /** Tier 5 零代码路径:声明式 config 内联于 manifest(无 entry 时由宿主直接应用)。 */
    config: WebExtConfigSchema.optional(),
  })
  .superRefine((m, ctx) => {
    if (m.entry !== undefined && m.integrity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["integrity"],
        message: "manifest with `entry` must declare `integrity` (SRI)",
      });
    }
  });
export type WebExtensionManifest = z.infer<typeof WebExtensionManifestSchema>;

/** 是否为纯声明扩展(无代码 bundle,走零加载路径)。 */
export function isDeclarativeOnly(m: WebExtensionManifest): boolean {
  return m.entry === undefined;
}

/**
 * 规范化用于签名的 manifest 字节(稳定 key 顺序,排除 signature 字段)。
 * 构建侧(签名)与宿主侧(验签)共用此函数,保证字节一致。
 */
export function canonicalManifestBytes(
  m: Omit<WebExtensionManifest, "signature">,
): string {
  const ordered = {
    id: m.id,
    targetApiVersion: m.targetApiVersion,
    entry: m.entry ?? null,
    css: m.css ?? null,
    integrity: m.integrity ?? null,
    capabilities: m.capabilities ?? null,
    config: m.config ?? null,
  };
  return JSON.stringify(ordered);
}

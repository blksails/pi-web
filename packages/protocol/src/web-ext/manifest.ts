/**
 * web-ext 契约 — WebExtension manifest(agent source `.pi/web` 的可序列化清单)。
 *
 * 由作者侧 `pi-web build` 产出。宿主加载前据此做安全门校验(SRI/签名/版本)。
 * 纯数据 + zod,不依赖 React(运行时携带组件的描述符在 `@pi-web/web-kit`)。
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
]);
export type WebExtensionCapability = z.infer<
  typeof WebExtensionCapabilitySchema
>;

/**
 * WebExtension 清单。`id` 唯一(CSS/registry 命名空间根);`targetApiVersion` 为
 * 兼容的 `@pi-web/web-kit` semver range。entry 存在则 integrity 必填(加载前校验完整性)。
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

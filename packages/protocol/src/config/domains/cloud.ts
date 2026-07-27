/**
 * 配置域 — cloud(pi-cloud 云端接入)。
 *
 * ## 为什么需要这个域(spec desktop-cloud-login,Req 8)
 *
 * 云端登录此前**只能**由进程环境变量启用。这在打包的桌面版里等于不可用:
 *  - 桌面壳的 `base_env()` 不转发该变量;
 *  - Finder 双击启动的应用没有 shell 环境;
 *  - 服务端 `.env` 从 cwd 读,而打包态 cwd 是每次升级即更换、且会被 GC 清理的运行时目录。
 *
 * 实测后果:双击打开的桌面版 `GET /api/auth/me` 返回 404(鉴权能力面未注册),
 * 登录入口不渲染 —— 登录组件、鉴权端点、凭据解析、钥匙串存取全做了,唯独缺
 * 「用户怎么告诉应用云端在哪」这一环。
 *
 * ## 为什么不复用 `auth` 域
 *
 * `auth` 是 `z.record(authProviderSchema)` —— **LLM provider 的 apiKey/baseURL**
 * (即 pi 自己的 `auth.json`),语义与「pi-cloud 出口地址」完全不同,混入会污染该文件。
 *
 * ## 为什么是配置域而非桌面壳读文件
 *
 * 云端地址是**服务端配置**。走配置域使浏览器部署与 CLI 部署同样受益(Req 8.8),
 * 且免费获得 schema 驱动的设置面板;桌面壳一行不改,不必承担「懂云端语义」这份职责。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";

/** 空串视为「未配置」;非空则必须是 http/https 绝对 URL。 */
const egressBaseSchema = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (v.length === 0) return true; // 未配置
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "必须是 http/https 开头的完整地址,例如 https://cloud.example/api/desktop/egress/v1" },
  )
  .describe(
    JSON.stringify({
      label: "云端出口地址",
      placeholder: "https://cloud.example/api/desktop/egress/v1",
      // ★ 修改后需重启:handler 是 pin 在 globalThis 的单例,本配置在**装配期**读一次。
      //    不写明会让用户改完没反应、误以为功能坏了(Req 8.7)。
      description:
        "pi-cloud 的桌面出口地址。填写并保存后**需重启应用**才生效(登录入口与鉴权端点在启动时装配)。留空则关闭云端登录。",
      order: 1,
    }),
  );

export const cloudConfigSchema = z.object({
  egressBase: egressBaseSchema.optional(),
});

export type CloudConfig = z.infer<typeof cloudConfigSchema>;

/** cloud 域的表单 IR(供设置面板 schema 驱动渲染)。 */
export const cloudFormSchema = zodToFormSchema("cloud", cloudConfigSchema, {
  title: "云端",
});

/**
 * 从已解析的 cloud 配置中取出出口地址。
 *
 * 空串/缺失/纯空白一律视为未配置 → `undefined`,与「未启用云端登录」等价(Req 8.5)。
 */
export function cloudEgressBaseOf(config: CloudConfig | undefined): string | undefined {
  const raw = config?.egressBase?.trim();
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

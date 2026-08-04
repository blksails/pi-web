/**
 * 配置域 — desktop(桌面版本机运行行为)。
 *
 * ## 为什么需要这个域(spec desktop-runtime-config)
 *
 * 与 `cloud` 域同源的一类问题:功能门控此前**只能**由进程环境变量给出,而打包的桌面版
 * 拿不到它们 —— Finder / `open` 启动的 GUI 应用不继承 shell 环境,也不读仓库里的
 * `.env.local`。结果是桌面版恒定运行在「全部增强功能关闭」的形态,用户无从改变。
 *
 * 开发者用 `pnpm dev:desktop` 时一切正常(该脚本带 `--env-file-if-exists=.env.local`),
 * 所以这个缺口在开发中完全不可见 —— 只有拿真实打包产物跑才会暴露。真机实测:
 * 桌面版 `/api/bootstrap` 下发 `sourcePicker=false`(同机 dev 为 `true`);
 * `/api/webext/resolve` 对本地 agent 返回 `found:true` 但 `rejectedReason:"代码 webext 未签名"`。
 *
 * ## 与 `cloud` 域的分工
 *
 * `cloud` 管「云端在哪」(出口地址),本域管「本机怎么跑」(功能门控与本机路径)。
 * 两者都只在桌面壳形态下才有实际影响,但语义不同,不合并。
 *
 * ## 取值优先级
 *
 * `env 显式值 > 本域配置 > 桌面默认值`。本域是中间一级 —— 它压不过运维显式给的环境变量,
 * 但盖得住随包的桌面默认值。裁决在 `lib/app/desktop-defaults.ts`,此处只定义载体。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";

const sourcePickerSchema = z
  .boolean()
  .describe(
    JSON.stringify({
      label: "显示 agent 源列表",
      // ★ 修改后需重启:门控在**装配期**读一次(handler 是 pin 在 globalThis 的单例)。
      //   不写明会让用户改完没反应、误以为配置坏了。
      description:
        "在选源页显示可浏览的 agent source 列表与收藏。修改后**需重启应用**才生效。桌面版默认开启。",
      order: 1,
    }),
  );

const requireWebextSignatureSchema = z
  .boolean()
  .describe(
    JSON.stringify({
      label: "要求 agent UI 扩展已签名",
      description:
        "开启后，未签名的 agent UI 扩展(pane 等)将被拒绝载入。桌面版默认关闭，" +
        "使本机路径的 agent 开箱可用；从 registry 装取的扩展**不受此项影响**，始终验签。" +
        "修改后需重启应用。",
      order: 2,
    }),
  );

const sourcesRootSchema = z
  .string()
  .trim()
  .describe(
    JSON.stringify({
      label: "agent 源扫描目录",
      placeholder: "~/.pi-web/agents",
      description:
        "扫描本机 agent 的根目录，留空则用默认位置。目录不存在时视为空，不影响其余来源。修改后需重启应用。",
      order: 3,
    }),
  );

export const desktopConfigSchema = z.object({
  sourcePicker: sourcePickerSchema.optional(),
  requireWebextSignature: requireWebextSignatureSchema.optional(),
  sourcesRoot: sourcesRootSchema.optional(),
});

export type DesktopConfig = z.infer<typeof desktopConfigSchema>;

/** desktop 域的表单 IR(供设置面板 schema 驱动渲染)。 */
export const desktopFormSchema = zodToFormSchema("desktop", desktopConfigSchema, {
  title: "桌面",
});

/**
 * 取出扫描根。
 *
 * 空串/缺失/纯空白一律视为未配置 → `undefined`,与「用默认位置」等价。
 */
export function desktopSourcesRootOf(config: DesktopConfig | undefined): string | undefined {
  const raw = config?.sourcesRoot?.trim();
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

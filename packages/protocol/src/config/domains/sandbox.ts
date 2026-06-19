/**
 * 配置域 — sandbox(pi-sandbox 的沙箱策略)。
 *
 * 双用途,共用同一 schema:
 *  - 全局(方案 A):写 `<agentDir>/sandbox.json`,经通用 `/config/sandbox` 端点。
 *  - 项目/按源(方案 B):写 `<projectDir>/.pi/sandbox.json`,经 `/config/sandbox/project` 端点。
 * pi-sandbox 运行时深合并 默认 ⊕ 全局 ⊕ 项目(项目优先);故二者字段语义一致,
 * 项目级通常是稀疏覆盖。所有字段可选,以支持稀疏覆盖与空文件(= 全部继承上层)。
 *
 * 字段语义(见 pi-sandbox README):
 *  - 读:不在 allowRead 即拦截;denyRead 只是"默认拒"区域,可被 allowRead 反超。
 *  - 写:denyWrite 硬拦截、压过 allowWrite;allowWrite 为空=全拒。
 *  - 网络:不在 allowedDomains 即拦截;deniedDomains 硬拦截。`.` = 项目目录(cwd)。
 */
import { z } from "zod";
import { zodToFormSchema } from "../zod-to-form-schema.js";
import type { FieldGroup } from "../form-schema.js";

export const SANDBOX_GROUPS: readonly FieldGroup[] = [
  { id: "general", title: "通用", order: 1 },
  { id: "network", title: "网络", order: 2 },
  { id: "filesystem", title: "文件系统", order: 3 },
];

const pathList = (label: string, order: number, description?: string) =>
  z
    .array(z.string())
    .optional()
    .describe(
      JSON.stringify({
        label,
        order,
        ...(description !== undefined ? { description } : {}),
      }),
    );

export const sandboxNetworkSchema = z
  .object({
    allowedDomains: pathList(
      "允许出网域名",
      1,
      "留空 = 默认不出网;支持 *.example.com 通配,\"*\" 放行所有(慎用)",
    ),
    deniedDomains: pathList("拒绝域名(硬拦截)", 2),
  })
  .passthrough();

export const sandboxFilesystemSchema = z
  .object({
    allowRead: pathList("可读路径", 1, "“.” = 项目目录;不在此列表的读取会被拦截"),
    allowWrite: pathList("可写路径", 2, "“.” = 项目目录;留空 = 全拒写"),
    denyRead: pathList("默认拒读区域", 3, "仅设默认拒;allowRead 可反超"),
    denyWrite: pathList("硬拦截写(永不放行)", 4, "压过 allowWrite,如 .env / *.key"),
  })
  .passthrough();

export const sandboxConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe(
        JSON.stringify({
          label: "启用沙箱",
          group: "general",
          order: 1,
          description: "关闭后该范围内不强制任何沙箱限制",
        }),
      ),
    network: sandboxNetworkSchema
      .optional()
      .describe(JSON.stringify({ label: "网络", group: "network", order: 2 })),
    filesystem: sandboxFilesystemSchema
      .optional()
      .describe(JSON.stringify({ label: "文件系统", group: "filesystem", order: 3 })),
  })
  .passthrough();

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

export const sandboxFormSchema = zodToFormSchema("sandbox", sandboxConfigSchema, {
  title: "沙箱",
  groups: SANDBOX_GROUPS,
});

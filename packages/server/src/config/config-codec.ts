/**
 * config-codec — 读写 `~/.pi/agent/*.json` 且保留未知字段。
 *
 * - 路径基于 `PI_WEB_AGENT_DIR` 环境变量(默认 `~/.pi/agent`),构造时可注入 `rootDir`
 *   覆盖(供测试)。
 * - `load(domain)`:读取 `{rootDir}/{domain}.json`,文件不存在返回 `{}`。
 * - `save(domain, values)`:将 `values` 深合并到磁盘原有内容上(保留未知字段/provider),
 *   写文件权限 0600、目录 0700(递归创建)。
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigDomainId } from "@blksails/pi-web-protocol";

function resolveDefaultRoot(): string {
  const fromEnv = process.env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

/**
 * 把 `incoming` 深合并到 `base` 上:对象类型的值递归合并,其余类型直接覆盖。
 * 结果为新对象,不修改 base 或 incoming。
 */
function deepMerge(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = result[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class ConfigCodec {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolveDefaultRoot();
  }

  private filePath(domain: ConfigDomainId): string {
    return join(this.rootDir, `${domain}.json`);
  }

  /**
   * 加载指定域的配置,文件不存在时返回 `{}`。
   */
  async load(domain: ConfigDomainId): Promise<Record<string, unknown>> {
    const path = this.filePath(domain);
    let text: string;
    try {
      text = await fs.readFile(path, "utf8");
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === "object" &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return {};
      }
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * 保存域配置。
   * - 默认(merge:true):将 `values` 深合并到磁盘已有内容,保留未知字段(增量补丁语义)。
   * - merge:false:`values` 已是权威全量对象(如经 `mergeSecrets` 合并出,含删除),
   *   直接覆盖写入。不可再对磁盘 deepMerge,否则已删除的键(secret clear / provider 删除)
   *   会从磁盘原值复活。
   * 写入权限 0600,目录 0700(递归创建)。
   */
  async save(
    domain: ConfigDomainId,
    values: Record<string, unknown>,
    opts: { readonly merge?: boolean } = {},
  ): Promise<void> {
    // 确保目录存在(0700)。
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });

    // 增量补丁默认与磁盘合并;权威全量则覆盖(保留删除)。
    const merged =
      opts.merge === false ? values : deepMerge(await this.load(domain), values);

    const path = this.filePath(domain);
    const json = JSON.stringify(merged, null, 2);
    await fs.writeFile(path, json, { encoding: "utf8", mode: 0o600 });
  }
}

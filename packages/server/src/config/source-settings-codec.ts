/**
 * source-settings-codec — per-source 设置读写(source/project 双作用域)。
 *
 * spec: source-settings-and-slots,任务 2.1;design.md「面⑦ 持久化与端点」;
 * Requirements 2.1-2.5。
 *
 * 落盘范式复刻 `./config-codec.ts`(同款 0700 目录 / 0600 文件 / 深合并语义),但键空间
 * 从固定 `ConfigDomainId` 换成 `(scope, sourceKey)`:
 * - `scope:"source"` → `<agentDir>/sources/<sourceKey>/settings.json`(per-source ×
 *   per-user,跨项目稳定;Req 2.1)。
 * - `scope:"project"` → `<cwd>/.pi/source-settings/<sourceKey>.json`(per-source ×
 *   per-cwd,独立于既有 `<cwd>/.pi/settings.json`,不并入,拍板 Q5;Req 2.2)。
 *
 * `sourceKey` 必须是 `isSourceKey()` 认可的 16 位 hex 形状(由 `sourceKey()` 工具派生,
 * 见 `../source-key.js`);本 codec 拒绝任何其他形状的输入,不把调用方传入的原始字符串
 * 直接拼进路径,防路径穿越(Req 2.5)。
 *
 * secret 处理:本 codec 是域无关的纯 JSON 存取层,不内置 secret 语义 —— 与 `ConfigCodec`
 * 对 `auth.json` 的既有处理方式一致(secret 明文落盘,0600 权限保护,GET 路径由调用方经
 * `maskSecrets` 掩码后再回吐浏览器;PUT 路径由调用方经 `mergeSecrets` 把 `SecretWrite`
 * 三态解析为明文后才调用 `save()`)。调用方(任务 2.2 的端点层)负责:
 * - 绝不把 `SecretMask`/`SecretWrite` 的原始壳对象直接传给 `save()`(那是协议层的读/写
 *   动作壳,不是要持久化的值);
 * - GET 前必须过 `maskSecrets()`,保证明文不回读浏览器(Req 2.3)。
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSourceKey } from "../source-key.js";

/** per-source settings 的持久化作用域(拍板 Q5)。 */
export type SourceSettingsScope = "source" | "project";

function resolveDefaultAgentDir(): string {
  const fromEnv = process.env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

/**
 * 把 `incoming` 深合并到 `base` 上:对象类型的值递归合并,其余类型直接覆盖。
 * 结果为新对象,不修改 base 或 incoming。与 `config-codec.ts` 的同名私有函数逻辑一致
 * (刻意不抽公共模块,保持两个 codec 各自独立可演进)。
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

function assertSourceKeyShape(sourceKey: string): void {
  if (!isSourceKey(sourceKey)) {
    throw new TypeError(
      `source-settings-codec: sourceKey must be a 16-hex-char shape produced by sourceKey(), got: ${JSON.stringify(sourceKey)}`,
    );
  }
}

export class SourceSettingsCodec {
  private readonly agentDir: string;

  constructor(agentDir?: string) {
    this.agentDir = agentDir ?? resolveDefaultAgentDir();
  }

  /**
   * 解析目标文件路径。
   * `scope:"project"` 必须提供 `cwd`(project 作用域按调用方 cwd 分区)。
   */
  private filePath(scope: SourceSettingsScope, sourceKeyValue: string, cwd?: string): string {
    assertSourceKeyShape(sourceKeyValue);
    if (scope === "source") {
      return join(this.agentDir, "sources", sourceKeyValue, "settings.json");
    }
    if (cwd === undefined || cwd.length === 0) {
      throw new TypeError("source-settings-codec: scope:\"project\" requires a non-empty cwd");
    }
    return join(cwd, ".pi", "source-settings", `${sourceKeyValue}.json`);
  }

  private dirPath(scope: SourceSettingsScope, sourceKeyValue: string, cwd?: string): string {
    assertSourceKeyShape(sourceKeyValue);
    if (scope === "source") {
      return join(this.agentDir, "sources", sourceKeyValue);
    }
    if (cwd === undefined || cwd.length === 0) {
      throw new TypeError("source-settings-codec: scope:\"project\" requires a non-empty cwd");
    }
    return join(cwd, ".pi", "source-settings");
  }

  /**
   * 加载指定作用域/source 的配置,文件不存在时返回 `{}`(Req 2.4)。
   */
  async load(
    scope: SourceSettingsScope,
    sourceKeyValue: string,
    cwd?: string,
  ): Promise<Record<string, unknown>> {
    const path = this.filePath(scope, sourceKeyValue, cwd);
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
   * 保存指定作用域/source 的配置。
   * - 默认(merge:true):将 `values` 深合并到磁盘已有内容,保留未知字段(增量补丁语义)。
   * - merge:false:`values` 已是权威全量对象(如经 `mergeSecrets` 合并出,含删除),直接
   *   覆盖写入,不可再对磁盘 deepMerge(否则已删除的键会从磁盘原值复活)。
   * 写入权限 0600,目录 0700(递归创建;Req 2.1, 2.2)。
   */
  async save(
    scope: SourceSettingsScope,
    sourceKeyValue: string,
    values: Record<string, unknown>,
    opts: { readonly cwd?: string; readonly merge?: boolean } = {},
  ): Promise<void> {
    const dir = this.dirPath(scope, sourceKeyValue, opts.cwd);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const merged =
      opts.merge === false
        ? values
        : deepMerge(await this.load(scope, sourceKeyValue, opts.cwd), values);

    const path = this.filePath(scope, sourceKeyValue, opts.cwd);
    const json = JSON.stringify(merged, null, 2);
    await fs.writeFile(path, json, { encoding: "utf8", mode: 0o600 });
  }
}

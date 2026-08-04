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
import { homedir } from "node:os";
import { join } from "node:path";
import { isSourceKey } from "../source-key.js";
import {
  createLocalWorkspaceNamespace,
  deepMergeJson,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceNamespace,
} from "../workspace/index.js";

/** per-source settings 的持久化作用域(拍板 Q5)。 */
export type SourceSettingsScope = "source" | "project";

function resolveDefaultAgentDir(): string {
  const fromEnv = process.env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

/**
 * 读 unknown 错误的 Workspace 判别码(契约 §3.6:按 `code` 判别,不用 `instanceof`)。
 */
function workspaceErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object") {
    const code = (err as { readonly code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
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
  /** 注入分支(config-workspace-injection Req 2):承载双根的注入 Workspace(如云端 TenantWorkspace)。 */
  private readonly workspace?: Workspace;

  constructor(source?: string | Workspace) {
    // 判别:`Workspace` 与路径字符串类型不相交,`string | undefined` 即路径分支,其余为注入。
    if (source === undefined || typeof source === "string") {
      this.agentDir = source ?? resolveDefaultAgentDir();
    } else {
      this.workspace = source;
      this.agentDir = resolveDefaultAgentDir(); // 注入分支不用,仅保持 agentDir: string
    }
  }

  /**
   * 解析目标命名空间与键(host-contract §3.7:source→user、project→`<cwd>/.pi` 命名空间)。
   * `scope:"project"` 必须提供 `cwd`。落盘路径与迁移前逐一致:
   * source → `<agentDir>/sources/<sourceKey>/settings.json`;
   * project → `<cwd>/.pi/source-settings/<sourceKey>.json`。
   */
  private nsAndKey(
    scope: SourceSettingsScope,
    sourceKeyValue: string,
    cwd?: string,
  ): { readonly ns: WorkspaceNamespace; readonly key: WorkspaceKey } {
    assertSourceKeyShape(sourceKeyValue);
    // 注入分支:source→`workspace.user`、project→`workspace.project`(注入的 project 根即目标,
    // 不再要求 cwd —— 云端无 per-cwd 项目,project 根按租户隔离)。落盘键与路径分支逐一致。
    if (this.workspace !== undefined) {
      return scope === "source"
        ? { ns: this.workspace.user, key: `sources/${sourceKeyValue}/settings.json` }
        : { ns: this.workspace.project, key: `source-settings/${sourceKeyValue}.json` };
    }
    // 路径分支(现状):source→`<agentDir>`、project→`<cwd>/.pi`。
    if (scope === "source") {
      return {
        ns: createLocalWorkspaceNamespace(this.agentDir),
        key: `sources/${sourceKeyValue}/settings.json`,
      };
    }
    if (cwd === undefined || cwd.length === 0) {
      throw new TypeError("source-settings-codec: scope:\"project\" requires a non-empty cwd");
    }
    return {
      ns: createLocalWorkspaceNamespace(join(cwd, ".pi")),
      key: `source-settings/${sourceKeyValue}.json`,
    };
  }

  /**
   * 加载指定作用域/source 的配置,文件不存在时返回 `{}`(Req 2.4)。
   * 逐分区复刻现状:缺文件→`{}`(readJson 归零);损坏/非对象→`{}`(catch `corrupt`,按 code);其余 io→rethrow。
   */
  async load(
    scope: SourceSettingsScope,
    sourceKeyValue: string,
    cwd?: string,
  ): Promise<Record<string, unknown>> {
    const { ns, key } = this.nsAndKey(scope, sourceKeyValue, cwd);
    try {
      return await ns.readJson(key);
    } catch (err: unknown) {
      if (workspaceErrorCode(err) === "corrupt") return {};
      throw err;
    }
  }

  /**
   * 保存指定作用域/source 的配置。
   * - 默认(merge:true):将 `values` 深合并到磁盘已有内容,保留未知字段(增量补丁语义)。
   * - merge:false:`values` 已是权威全量对象(如经 `mergeSecrets` 合并出,含删除),直接
   *   覆盖写入(保留删除)。
   * read-modify-write 在本层完成、底层 `writeJson` 恒 `merge:false`(同 M2:损坏磁盘时合并基底
   * 走 `load` 的降级,不因二次 read 抛 corrupt);合并语义收敛到 `deepMergeJson`(删私有副本)。
   * 写入 0600 / 目录 0700 / 原子写由 Workspace 承接。
   */
  async save(
    scope: SourceSettingsScope,
    sourceKeyValue: string,
    values: Record<string, unknown>,
    opts: { readonly cwd?: string; readonly merge?: boolean } = {},
  ): Promise<void> {
    const { ns, key } = this.nsAndKey(scope, sourceKeyValue, opts.cwd);
    const next =
      opts.merge === false
        ? values
        : deepMergeJson(await this.load(scope, sourceKeyValue, opts.cwd), values);
    await ns.writeJson(key, next, { merge: false });
  }
}

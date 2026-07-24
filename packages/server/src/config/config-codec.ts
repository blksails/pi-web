/**
 * config-codec — 读写 config 域(`~/.pi/agent/<domain>.json`)且保留未知字段。
 *
 * host-contract v1(M2 垂直切片,spec: host-contract-config-on-workspace):内部改建到
 * `LocalWorkspace` 的 `user` 命名空间之上(§3.7「既有端口保留各自类型化接口不变,只是
 * 默认实现改建在 Workspace 上」)。公开面(构造 / `load` / `save`)、落盘路径 / 权限 /
 * 字节格式与改建前**逐字节不变**;不再直接触碰 `node:fs`,合并语义收敛到 `deepMergeJson`。
 *
 * - 路径基于 `PI_WEB_AGENT_DIR`(默认 `~/.pi/agent`),构造时可注入 `rootDir` 覆盖(供测试)。
 * - `load(domain)`:委托 `WorkspaceNamespace.readJson`,逐分区复刻既有语义——缺文件 / 损坏 /
 *   非对象 → `{}`(损坏降级并记日志,契约 §3.6),其余 IO 错误 → rethrow。
 * - `save(domain, values, { merge })`:read-modify-write 在本层完成,底层 `writeJson` 恒
 *   `merge:false`;目录 0700 / 文件 0600 / 原子写由 Workspace 承接。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3.6 / §3.7。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigDomainId } from "@blksails/pi-web-protocol";
import { createLogger } from "@blksails/pi-web-logger";
import {
  createLocalWorkspaceNamespace,
  deepMergeJson,
  type WorkspaceNamespace,
} from "../workspace/index.js";

const logger = createLogger({ namespace: "server:config" });

function resolveDefaultRoot(): string {
  const fromEnv = process.env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

/**
 * 读 unknown 错误的 Workspace 判别码。
 *
 * 契约 §3.6:错误一律按 `err.code` 判别,不用 `instanceof`——跨包 / 跨仓时同名类可能来自
 * 不同模块实例,`instanceof` 会假阴性。
 */
function workspaceErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object") {
    const code = (err as { readonly code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export class ConfigCodec {
  private readonly ns: WorkspaceNamespace;

  constructor(source?: string | WorkspaceNamespace) {
    // 两条构造分支(config-workspace-injection Req 1):
    //  · **注入分支**(传入已构造的 `WorkspaceNamespace`,如云端 `TenantWorkspace.user`):直接承载,
    //    不自建 LocalWorkspace —— 使 config.domains 读写导向注入的(租户隔离的)命名空间。
    //  · **路径分支**(string / undefined,现状):建在 LocalWorkspace user 命名空间之上(§3.7)。
    //    不传 maxValueBytes → 取缺省 1 MiB 安全网;刻意不经 `resolveWorkspaceValueLimit(env)`,
    //    以免为 config 域引入「非法 env → 构造抛错」的新失败模式,保持行为零变化。
    // 判别:`Workspace*` 与路径字符串类型不相交,故 `string | undefined` 即路径分支,其余为注入。
    this.ns =
      source === undefined || typeof source === "string"
        ? createLocalWorkspaceNamespace(source ?? resolveDefaultRoot())
        : source;
  }

  /**
   * 加载指定域的配置。逐分区复刻既有 `ConfigCodec.load` 语义:
   * 缺文件 → `{}`(由 `readJson` 归零);损坏 / 非对象 JSON → `{}`(捕获 `corrupt` 降级,
   * 契约 §3.6 记日志);其余 IO 错误 → rethrow(复刻既有对非 ENOENT 读错的抛出)。
   */
  async load(domain: ConfigDomainId): Promise<Record<string, unknown>> {
    try {
      return await this.ns.readJson(`${domain}.json`);
    } catch (err: unknown) {
      if (workspaceErrorCode(err) === "corrupt") {
        logger.warn("config domain file corrupt; treating as empty", { domain });
        return {};
      }
      throw err;
    }
  }

  /**
   * 保存域配置。
   * - 默认(merge:true):将 `values` 深合并到磁盘已有内容,保留未知字段(增量补丁语义)。
   * - merge:false:`values` 已是权威全量对象(如经 `mergeSecrets` 合并出,含删除),直接
   *   覆盖写入。不可再对磁盘 deepMerge,否则已删除的键(secret clear / provider 删除)会复活。
   *
   * read-modify-write 在本层完成、底层 `writeJson` 恒 `merge:false`:既逐字节复刻既有
   * `deepMerge(load(domain), values)` 后覆盖写的语义,又使损坏磁盘时的合并基底走 `load`
   * 的统一降级(不因底层二次 read 抛 `corrupt`)。写入权限 0600、目录 0700、原子写。
   */
  async save(
    domain: ConfigDomainId,
    values: Record<string, unknown>,
    opts: { readonly merge?: boolean } = {},
  ): Promise<void> {
    const next =
      opts.merge === false ? values : deepMergeJson(await this.load(domain), values);
    await this.ns.writeJson(`${domain}.json`, next, { merge: false });
  }
}

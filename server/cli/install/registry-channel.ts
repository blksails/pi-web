/**
 * registry-channel(spec installer-registry-channel,任务 1.2)——
 * `RegistryChannel` 端口的**唯一**实现。
 *
 * ## 为什么在这一层
 *
 * 它经 `./registry-install.js` 间接依赖 `@pi-clouds/registry-client`(不是 npm 依赖,是经三处
 * 别名指向兄弟仓源码)。`server/cli/**` 已经在这个世界里,直连合法;而 `lib/app/**` 只能**惰性**
 * 委托进来(见 `lib/app/online-source/registry-channel-adapter.ts`),`packages/server/src` 则一概
 * 不得触碰。把逻辑放这里,两个宿主共用同一份实现,不会漂移。
 *
 * ## 职责边界
 *
 * 只做:标识解析 → resolve → **kind 门** → 定落点 → 委托 `installFromRegistry` → 归一失败。
 * 不做:下载、解包、sha384 复核、回滚、原子落盘、写回执(全在 `installFromRegistry`,一行不改);
 * 也不做 plugin 的最后一段交接(那在 `Installer` 里,本模块不认识 pi 的包台账)。
 *
 * ## kind 门为什么在下载之前
 *
 * `RegistryPort.resolve()` 已经带回已验签清单,清单里就有权威 `kind`。因此「命令说 agent、包其实
 * 是 plugin」这种错配可以在**零字节下载**时拒绝 —— 既省流量,也避免把不该落的东西写进磁盘。
 *
 * ## 缺省值陷阱(必读)
 *
 * pi-web 侧 `pi-web.json#kind` 缺省 `plugin`,registry 侧 `SourceManifest.kind` 缺省 `agent`,
 * **两侧相反**。所以清单缺 `kind` 时**不能猜**,一律 `MANIFEST_KIND_UNKNOWN` 如实报错。
 *
 * ## 凭据卫生
 *
 * 授予令牌只经 adapter 进 Authorization 头。失败归一时刻意丢弃底层 `detail` —— 它可能夹带
 * 含令牌的请求 URL(与 `lib/app/online-source/registry-install-port.ts` 同一裁断)。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isValidSourceId,
  parseOnlineSourceRef,
  DEFAULT_REGISTRY_CHANNEL,
} from "@blksails/pi-web-server";
import type { PluginKind } from "@blksails/pi-web-protocol";
import type {
  RegistryChannel,
  RegistryChannelError,
  RegistryMaterialization,
  RegistryMaterializeOptions,
  Result,
} from "./installer.js";
import {
  installFromRegistry,
  readInstallReceipt,
  registryInstallDirName,
  type InstallError as RegistryInstallError,
} from "./registry-install.js";
import type { RegistryPort, SignedManifest } from "../registry/registry-port.js";

const fail = (error: RegistryChannelError): Result<never, RegistryChannelError> => ({
  ok: false,
  error,
});

export interface CreateRegistryChannelOptions {
  /**
   * 惰性取得 `RegistryPort`。未配置 / 未登录 / 无授予 → `undefined`(→ `NOT_AUTHENTICATED`)。
   * 惰性是刻意的:装配时不该为了「也许会装线上包」去取一次授予。
   */
  readonly getRegistry: () => Promise<RegistryPort | undefined>;
  /** agent 的最终落点根(应为 agent 源扫描根,使装完即被枚举)。 */
  readonly agentTargetRoot: string;
  /**
   * plugin 的最终落点根。**必须与 agent 扫描根分开**,否则 plugin 会被源枚举当成 agent 源列出。
   *
   * ★ 这是**长期**落点,不是暂存目录 —— 实测:`pi install <本地目录>` 不拷贝内容,只把路径
   *   写进 pi 的 `settings.json#plugins[]`,运行时从原目录加载。落 tmpdir 或事后清理都会让
   *   插件失效(重启后 pi 指向一个已不存在的路径)。
   */
  readonly pluginTargetRoot: string;
}

/** 标识解析结果。`channel` 恒有值(裸标识补默认),原因见下。 */
interface ParsedSpec {
  readonly sourceId: string;
  readonly channel: string;
}

/**
 * 解析 registry 标识。
 *
 * ★ 两个不能省的细节,都是勘察实测所得:
 *
 * 1. **不能直接用 `parseOnlineSourceRef`**:它要求恰有一个 `@`,对裸标识
 *    (`acme/hello-cloud` —— 正是命令面最常见的形态)返回 `undefined`。
 *    故此处分两支;但字符集与路径穿越校验一律复用 `isValidSourceId`,不自写第二套规则。
 *
 * 2. **裸标识必须补上默认 channel**:`RegistryHttpClient.resolve()` 在 channel 与 version
 *    都缺席时**直接抛 VALIDATION**,不存在「服务端替我选默认」这回事。选择器路径没踩到这个坑
 *    只是因为它的标识恒带 `@channel`。默认值复用 `DEFAULT_REGISTRY_CHANNEL`("stable"),
 *    与列举面同源;显式落进安装回执后,`pi-web update` 也才知道该跟踪哪个 channel。
 */
export function parseRegistrySpec(spec: string): ParsedSpec | undefined {
  const s = spec.trim();
  if (s.length === 0) return undefined;
  if (s.includes("@")) {
    const ref = parseOnlineSourceRef(s);
    return ref === undefined ? undefined : { sourceId: ref.sourceId, channel: ref.channel };
  }
  return isValidSourceId(s) ? { sourceId: s, channel: DEFAULT_REGISTRY_CHANNEL } : undefined;
}

const KINDS: readonly PluginKind[] = ["agent", "plugin", "component"];

/**
 * 从已验签清单读取权威 `kind`。缺失或非法一律返回 `undefined` —— 调用方据此报
 * `MANIFEST_KIND_UNKNOWN`,**不做任何缺省推断**(见文件头「缺省值陷阱」)。
 */
export function readManifestKind(manifest: SignedManifest): PluginKind | undefined {
  const raw = manifest["kind"];
  return typeof raw === "string" && KINDS.includes(raw as PluginKind)
    ? (raw as PluginKind)
    : undefined;
}

/**
 * `RegistryError.code` → 通道失败分类。
 *
 * ★ 早先把「非 SOURCE_ABSENT 的一切」一律压成 `GRANT_UNAVAILABLE`,真机实测暴露了它的害处:
 *   标识写错(源不存在)时提示「登录已过期」,把人引向完全错误的排查方向。现按语义分开,
 *   但仍**只传受控枚举、不传底层 detail**(detail 可能夹带含令牌的请求 URL)。
 */
function mapResolveError(sourceId: string, code: string): RegistryChannelError {
  switch (code) {
    case "SOURCE_ABSENT":
      return { code: "NOT_FOUND", sourceId };
    case "FORBIDDEN":
      return { code: "GRANT_UNAVAILABLE" };
    case "UNREACHABLE":
      return { code: "RESOLVE_FAILED", reason: "unreachable" };
    case "VERSION_REJECTED":
      return { code: "RESOLVE_FAILED", reason: "rejected" };
    default:
      return { code: "RESOLVE_FAILED", reason: "other" };
  }
}

/** 底层 `RESOLVE_FAILED.detail`(`JSON.stringify(RegistryError)`)里判别「源不存在」。 */
function isSourceAbsent(detail: string): boolean {
  try {
    const parsed: unknown = JSON.parse(detail);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { code?: unknown }).code === "SOURCE_ABSENT"
    );
  } catch {
    return false;
  }
}

function mapInstallError(sourceId: string, e: RegistryInstallError): RegistryChannelError {
  switch (e.code) {
    case "RESOLVE_FAILED":
      // 这一层的 detail 是 `JSON.stringify(RegistryError)`,只能反解;非「源不存在」时
      // 不再谎称授予问题,归入 RESOLVE_FAILED/other。
      return isSourceAbsent(e.detail)
        ? { code: "NOT_FOUND", sourceId }
        : { code: "RESOLVE_FAILED", reason: "other" };
    case "UNSUPPORTED_ORIGIN":
      return { code: "UNSUPPORTED_DISTRIBUTION", originType: e.originType };
    case "DOWNLOAD_FAILED":
      return { code: "DOWNLOAD_FAILED" };
    case "EXTRACT_FAILED":
      return { code: "EXTRACT_FAILED" };
    case "INTEGRITY_MISMATCH":
      return { code: "INTEGRITY_MISMATCH" };
  }
}

export function createRegistryChannel(options: CreateRegistryChannelOptions): RegistryChannel {
  return {
    async materialize(
      spec: string,
      opts: RegistryMaterializeOptions,
    ): Promise<Result<RegistryMaterialization, RegistryChannelError>> {
      const parsed = parseRegistrySpec(spec);
      // 形态不合法 → 报「找不到」而非泄露解析细节;sourceId 用原样 spec 便于用户对照。
      if (parsed === undefined) return fail({ code: "NOT_FOUND", sourceId: spec });

      const registry = await options.getRegistry();
      if (registry === undefined) return fail({ code: "NOT_AUTHENTICATED" });

      // ── 1) resolve:取回已验签清单,拿到权威 kind(此步**不下载任何包体**) ──
      const resolved = await registry.resolve(parsed.sourceId, { channel: parsed.channel });
      if (!resolved.ok) return fail(mapResolveError(parsed.sourceId, resolved.error.code));

      // ── 2) kind 门(下载之前) ──
      const kind = readManifestKind(resolved.value.manifest);
      if (kind === undefined) return fail({ code: "MANIFEST_KIND_UNKNOWN" });
      if (kind === "component") return fail({ code: "KIND_COMPONENT_UNSUPPORTED" });
      if (opts.expectedKind !== undefined && opts.expectedKind !== kind) {
        return fail({ code: "KIND_MISMATCH", actual: kind, expected: opts.expectedKind });
      }

      // ── 3) 按 kind 定落点(两者都是长期位置,见文件头/选项注释) ──
      const dirName = registryInstallDirName(parsed.sourceId);
      const targetDir = join(
        kind === "agent" ? options.agentTargetRoot : options.pluginTargetRoot,
        dirName,
      );
      // 目标位置保护:已存在但不是本通道装的(无回执)→ 拒绝,不静默覆盖用户手放的同名目录。
      if (existsSync(targetDir) && readInstallReceipt(targetDir) === undefined) {
        return fail({ code: "TARGET_OCCUPIED", dir: targetDir });
      }

      // ── 4) 委托既有实现:下载 → 解包 → sha384 复核 → 回滚/原子落盘 → 写回执 ──
      const installed = await installFromRegistry(registry, parsed.sourceId, {
        channel: parsed.channel,
        targetDir,
      });
      if (!installed.ok) return fail(mapInstallError(parsed.sourceId, installed.error));

      return {
        ok: true,
        value: {
          kind,
          sourceId: installed.value.sourceId,
          version: installed.value.version,
          dir: installed.value.targetDir,
          verifiedFiles: installed.value.verifiedFiles,
        },
      };
    },
  };
}

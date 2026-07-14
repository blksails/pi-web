/**
 * createInstallArgProvider — `/install` 子命令/参数补全的默认数据 provider
 * (spec install-host-command,任务 3.3)。取代 `plugin-arg-provider.ts`(旧 `/plugin` 命令
 * 已摘除,见 tool-kit ExtensionManagerRemoval)。
 *
 * 静态 argSpec 覆盖四子动作(install/uninstall/list/update);参数候选经现成 REST 取数:
 *   - install(localSource)      → `GET /sessions/:id/install-sources?q`(扫会话 cwd,同 /plugin 旧径)。
 *   - uninstall(installedPackage) → `GET /extensions` ∪ `GET /agent-sources` 合并(agent 项
 *     insertText 追加 " --kind agent",规避缺省 kind 走错通道,见 handler kind 分派)。
 *   - update(installedPackage)  → 仅 `GET /extensions`(update 只有 plugin 通道,CLI 亦无 agent 更新)。
 *   - list:terminal,无参数候选。
 * 命令面板只依赖 CommandArgProvider 窄接口,本工厂在装配层(知道 baseUrl/sessionId)构造。
 */
import type {
  CommandArgItem,
  CommandArgProvider,
  CommandArgSpec,
} from "./command-arg.js";
import { findSubcommand } from "./command-arg.js";

const INSTALL_SPEC: CommandArgSpec = {
  command: "install",
  subcommands: [
    { name: "install", terminal: false, argKind: "localSource" },
    { name: "uninstall", terminal: false, argKind: "installedPackage" },
    { name: "list", terminal: true },
    { name: "update", terminal: false, argKind: "installedPackage" },
  ],
};

interface InstalledExtensionDto {
  readonly id: string;
  readonly kind?: string;
  readonly version?: string;
}
interface InstallSourceDto {
  readonly path: string;
  readonly insertText: string;
}
interface AgentSourceDto {
  readonly id: string;
  readonly name: string;
}

/**
 * 判断一个 `pi list` 解析出的 id 是否为可卸载目标:非空、不含空白(排除 "User packages:"
 * 这类表头)、非绝对路径(排除 node_modules 完整路径)。
 */
function isUninstallTarget(id: string): boolean {
  const s = id.trim();
  return s.length > 0 && !/\s/.test(s) && !s.startsWith("/");
}

function join(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface InstallArgProviderOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  /** 注入式 fetch(默认全局 fetch),便于测试。 */
  readonly fetchImpl?: typeof fetch;
}

export function createInstallArgProvider(
  opts: InstallArgProviderOptions,
): CommandArgProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  async function installedPlugins(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]> {
    const res = await doFetch(join(opts.baseUrl, "/extensions"), {
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { extensions?: InstalledExtensionDto[] };
    const q = query.toLowerCase();
    return (data.extensions ?? [])
      // 过滤 `pi list` 解析出的噪声行(表头如 "User packages:"、绝对路径):卸载目标应为
      // 形如 npm:/git: 的包标识,不含空白、非绝对路径。
      .filter((e) => isUninstallTarget(e.id))
      .filter((e) => q.length === 0 || e.id.toLowerCase().includes(q))
      .map((e) => ({
        id: e.id,
        label: e.id,
        insertText: e.id,
        ...(e.kind !== undefined ? { detail: e.kind } : {}),
      }));
  }

  async function installedAgentSources(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]> {
    const res = await doFetch(join(opts.baseUrl, "/agent-sources"), {
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { sources?: AgentSourceDto[] };
    const q = query.toLowerCase();
    return (data.sources ?? [])
      .filter(
        (s) =>
          q.length === 0 ||
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      )
      .map((s) => ({
        id: s.id,
        label: s.name,
        // agent 候选须显式带 --kind agent:uninstall 缺省探测可能落错通道(见 installer kind 分派)。
        insertText: `${s.id} --kind agent`,
        detail: "agent",
      }));
  }

  async function localSources(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]> {
    const url = join(
      opts.baseUrl,
      `/sessions/${encodeURIComponent(opts.sessionId)}/install-sources?q=${encodeURIComponent(query)}`,
    );
    const res = await doFetch(url, {
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { sources?: InstallSourceDto[] };
    return (data.sources ?? []).map((s) => ({
      id: s.path,
      label: s.path,
      insertText: s.insertText,
      detail: "local",
    }));
  }

  return {
    specFor: (command) => (command === "install" ? INSTALL_SPEC : undefined),
    listArgs: (command, sub, query, signal) => {
      if (command !== "install") return Promise.resolve([]);
      const spec = findSubcommand(INSTALL_SPEC, sub);
      if (spec?.argKind === "localSource") return localSources(query, signal);
      if (spec?.argKind === "installedPackage") {
        if (spec.name === "update") return installedPlugins(query, signal);
        return Promise.all([
          installedPlugins(query, signal),
          installedAgentSources(query, signal),
        ]).then(([plugins, agents]) => [...plugins, ...agents]);
      }
      return Promise.resolve([]);
    },
  };
}

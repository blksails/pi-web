/**
 * createPluginArgProvider — `/plugin` 子命令/参数补全的默认数据 provider
 * (plugin-subcommand-completion)。
 *
 * 静态 argSpec 与真实 `/plugin` 命令对齐(install <local 源>[-l] / uninstall <名> / list);
 * 参数候选经现成 REST 取数:
 *   - uninstall(installedExt) → `GET /extensions`(PiCli.listExtensions,结构化 id)。
 *   - install(localSource)    → `GET /sessions/:id/install-sources?q`(扫会话 cwd)。
 * 命令面板只依赖 CommandArgProvider 窄接口,本工厂在装配层(知道 baseUrl/sessionId)构造。
 */
import type {
  CommandArgItem,
  CommandArgProvider,
  CommandArgSpec,
} from "./command-arg.js";

const PLUGIN_SPEC: CommandArgSpec = {
  command: "plugin",
  subcommands: [
    { name: "install", aliases: ["add"], terminal: false, argKind: "localSource" },
    {
      name: "uninstall",
      aliases: ["remove"],
      terminal: false,
      argKind: "installedExt",
    },
    { name: "list", aliases: ["ls"], terminal: true },
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

function join(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface PluginArgProviderOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  /** 注入式 fetch(默认全局 fetch),便于测试。 */
  readonly fetchImpl?: typeof fetch;
}

export function createPluginArgProvider(
  opts: PluginArgProviderOptions,
): CommandArgProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  async function installed(
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
      .filter((e) => q.length === 0 || e.id.toLowerCase().includes(q))
      .map((e) => ({
        id: e.id,
        label: e.id,
        insertText: e.id,
        ...(e.kind !== undefined ? { detail: e.kind } : {}),
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
    specFor: (command) => (command === "plugin" ? PLUGIN_SPEC : undefined),
    listArgs: (command, sub, query, signal) => {
      if (command !== "plugin") return Promise.resolve([]);
      const spec = PLUGIN_SPEC.subcommands.find(
        (s) =>
          s.name === sub || (s.aliases ?? []).includes(sub),
      );
      if (spec?.argKind === "installedExt") return installed(query, signal);
      if (spec?.argKind === "localSource") return localSources(query, signal);
      return Promise.resolve([]);
    },
  };
}

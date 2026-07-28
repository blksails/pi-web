/**
 * createPackageArgProvider — `/agent` 与 `/plugin` 的子命令/参数补全数据 provider
 * (spec agent-plugin-commands,任务 3.2;取代 `install-arg-provider.ts`)。
 *
 * **单个** provider 同时服务两条命令:命令面板只接受一个 `commandArgProvider`
 * (见 PiChat 装配与 palette 的 `specFor(cmdName)` 单点查询),故此处按命令名分派两套 spec,
 * 而非并列两个工厂。
 *
 * 候选来源按域分道(不再有"插件 ∪ agent 源"的合并候选):
 *   - agent install / plugin install → `GET /sessions/:id/install-sources?q`(扫会话 cwd)
 *   - agent uninstall                → `GET /agent-sources`
 *   - plugin uninstall / update      → `GET /extensions`
 *   - list                           → terminal,无参数候选
 *
 * 类别锁定后,agent 候选**不再**拼接 `--kind agent`:命令名已经决定通道。
 */
import type {
  CommandArgItem,
  CommandArgProvider,
  CommandArgSpec,
} from "./command-arg.js";
import { findSubcommand } from "./command-arg.js";

const AGENT_SPEC: CommandArgSpec = {
  command: "agent",
  subcommands: [
    {
      name: "install",
      terminal: false,
      argKind: "localSource",
      descriptionKey: "commandArg.agent.install",
    },
    {
      name: "uninstall",
      terminal: false,
      argKind: "installedAgent",
      descriptionKey: "commandArg.agent.uninstall",
    },
    { name: "list", terminal: true, descriptionKey: "commandArg.agent.list" },
    {
      name: "publish",
      terminal: false,
      argKind: "publishableDir",
      descriptionKey: "commandArg.agent.publish",
    },
  ],
};

const PLUGIN_SPEC: CommandArgSpec = {
  command: "plugin",
  subcommands: [
    {
      name: "install",
      terminal: false,
      argKind: "localSource",
      descriptionKey: "commandArg.plugin.install",
    },
    {
      name: "uninstall",
      terminal: false,
      argKind: "installedPlugin",
      descriptionKey: "commandArg.plugin.uninstall",
    },
    { name: "list", terminal: true, descriptionKey: "commandArg.plugin.list" },
    {
      name: "update",
      terminal: false,
      argKind: "installedPlugin",
      descriptionKey: "commandArg.plugin.update",
    },
    {
      name: "publish",
      terminal: false,
      argKind: "publishableDir",
      descriptionKey: "commandArg.plugin.publish",
    },
  ],
};

const SPECS: Readonly<Record<string, CommandArgSpec>> = {
  agent: AGENT_SPEC,
  plugin: PLUGIN_SPEC,
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

export interface PackageArgProviderOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  /** 注入式 fetch(默认全局 fetch),便于测试。 */
  readonly fetchImpl?: typeof fetch;
}

export function createPackageArgProvider(
  opts: PackageArgProviderOptions,
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
        // 命令名已锁定 agent 通道 → 插入文本只含标识本身(拆分前需拼 " --kind agent")。
        insertText: s.id,
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

  /**
   * 可发布目录候选。走**独立端点** `/publish-sources` —— 判据是「含发布清单」,
   * 与安装候选(入口/包描述文件)不同;且 insertText 是目录路径本身,不带 `local:` 前缀。
   */
  async function publishableDirs(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]> {
    const url = join(
      opts.baseUrl,
      `/sessions/${encodeURIComponent(opts.sessionId)}/publish-sources?q=${encodeURIComponent(query)}`,
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
      detail: "publishable",
    }));
  }

  return {
    specFor: (command) => SPECS[command],
    listArgs: (command, sub, query, signal) => {
      const spec = SPECS[command];
      if (spec === undefined) return Promise.resolve([]);
      const subSpec = findSubcommand(spec, sub);
      switch (subSpec?.argKind) {
        case "localSource":
          return localSources(query, signal);
        case "installedAgent":
          return installedAgentSources(query, signal);
        case "installedPlugin":
          return installedPlugins(query, signal);
        case "publishableDir":
          return publishableDirs(query, signal);
        default:
          return Promise.resolve([]);
      }
    },
  };
}

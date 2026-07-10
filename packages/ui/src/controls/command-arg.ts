/**
 * 命令参数补全契约 + 阶段解析(plugin-subcommand-completion)。
 *
 * 命令面板对声明了 argSpec 的命令(如 /plugin)做前缀上下文相关的分阶段补全:
 *   命令名 → 子命令 → 参数。本模块只含纯数据契约与纯函数 `parseCommandStage`,
 *   不依赖 DOM/transport,便于单测。数据获取经装配层注入的 CommandArgProvider。
 */

/** 一个参数候选(渲染进命令面板既有浮层)。 */
export interface CommandArgItem {
  readonly id: string;
  readonly label: string;
  /** 填入"参数段"的文本(如已装扩展 id 或 `local:<rel>`)。 */
  readonly insertText: string;
  readonly detail?: string;
}

/** 某命令的一个子命令规格。 */
export interface SubcommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  /** 终态:无需后续参数(如 list),靠 Enter 执行。 */
  readonly terminal: boolean;
  /**
   * 非终态的参数类型,驱动 listArgs 的数据源。`installedExt` 为 `/plugin` 遗留(仅装/卸插件);
   * `installedPackage` 为 `/install` 通用候选(插件 ∪ agent 源合并,见 install-arg-provider)。
   */
  readonly argKind?: "installedExt" | "localSource" | "installedPackage";
}

/** 某命令的参数补全规格。 */
export interface CommandArgSpec {
  /** 命令名(不含前导 "/")。 */
  readonly command: string;
  readonly subcommands: readonly SubcommandSpec[];
}

/** 装配层注入的窄接口:静态 specFor + 异步 listArgs。命令面板不直接持有 HTTP。 */
export interface CommandArgProvider {
  specFor(command: string): CommandArgSpec | undefined;
  listArgs(
    command: string,
    sub: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly CommandArgItem[]>;
}

/** 当前补全阶段。 */
export type CommandStage =
  | { readonly kind: "command"; readonly query: string }
  | {
      readonly kind: "subcommand";
      readonly command: string;
      readonly query: string;
    }
  | {
      readonly kind: "arg";
      readonly command: string;
      readonly sub: SubcommandSpec;
      readonly query: string;
      /** 参数段在 value 内的替换区间 [start,end)。 */
      readonly start: number;
      readonly end: number;
    };

/** 按名或别名查子命令。 */
export function findSubcommand(
  spec: CommandArgSpec,
  name: string,
): SubcommandSpec | undefined {
  const lower = name.toLowerCase();
  return spec.subcommands.find(
    (s) =>
      s.name.toLowerCase() === lower ||
      (s.aliases ?? []).some((a) => a.toLowerCase() === lower),
  );
}

/**
 * 依据输入与 argSpec 解析当前阶段(纯函数)。`value` 形如 `/cmd …`。spec 缺省 → 命令名阶段
 * (query 为整段,沿用既有命令名过滤)。畸形输入安全降级,不抛。
 */
export function parseCommandStage(
  value: string,
  spec: CommandArgSpec | undefined,
): CommandStage {
  if (!value.startsWith("/")) {
    return { kind: "command", query: value };
  }
  const rest = value.slice(1);
  const cmd = rest.split(/\s+/)[0] ?? "";

  // 无 spec → 维持既有命令名补全(整段为 query)。
  if (spec === undefined) {
    return { kind: "command", query: rest };
  }

  const afterCmd = rest.slice(cmd.length);
  // 命令名尚未以空白收尾 → 仍在打命令名。
  if (!/^\s/.test(afterCmd)) {
    return { kind: "command", query: cmd };
  }

  // 命令已定,进入子命令/参数区。
  const subAndRest = afterCmd.replace(/^\s+/, "");
  const subEndsSpace = /\s$/.test(subAndRest);
  const subTokens = subAndRest.length > 0 ? subAndRest.split(/\s+/) : [];
  const subName = subTokens[0] ?? "";
  const matched = subName.length > 0 ? findSubcommand(spec, subName) : undefined;

  const subSettled =
    matched !== undefined && (subTokens.length > 1 || subEndsSpace);

  if (!subSettled || matched === undefined || matched.terminal) {
    // 仍在选/打子命令,或终态子命令(靠 Enter 执行)。
    return { kind: "subcommand", command: cmd, query: subName };
  }

  // 参数阶段:定位"当前参数段"(末段 token)。
  const argPart = subAndRest.slice(subName.length).replace(/^\s+/, "");
  const argEndsSpace = /\s$/.test(argPart);
  const argTokens = argPart.length > 0 ? argPart.split(/\s+/) : [];
  const currentArg = argEndsSpace ? "" : (argTokens[argTokens.length - 1] ?? "");
  const start = value.length - currentArg.length;
  return {
    kind: "arg",
    command: cmd,
    sub: matched,
    query: currentArg,
    start,
    end: value.length,
  };
}

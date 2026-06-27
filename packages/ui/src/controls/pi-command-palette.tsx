/**
 * PiCommandPalette — "/" 斜杠命令补全。
 *
 * `value` 以 "/" 开头时进入命令模式:经 `controls.getCommands` 拉取候选,按输入过滤;
 * 方向键导航 / 回车确认 / Esc 关闭;选择把命令填充回输入区(经 onChange)。
 * aria 标注当前活动项(listbox/option + aria-activedescendant)。
 * 命令为空或获取失败 → 显示空态/错误态,不崩溃。
 *
 * 扩展命令默认隐藏:pi 的扩展命令(pi.registerCommand 注册,source==="extension")在
 * RPC/web 模式下由 agent 进程本地执行后**提前返回、从不发 agent_end**(见
 * pi-coding-agent agent-session.prompt:命中扩展命令即 `return`,不走 _runAgentPrompt)。
 * 而 pi-web 把每个斜杠命令都当普通 prompt 发送,pending(停止按钮)要等流上的
 * finish/error/abort chunk 才解除——扩展命令永不产生该 chunk,这一轮会永久卡住。
 * 故默认从补全里隐藏所有扩展命令;可经 `extensionCommands` 策略放行(全局开关 + 白名单)。
 * prompt / skill 类命令走 LLM 一轮,正常发 agent_end,不受影响。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@blksails/pi-web-react";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";
import type { UiRpcClient } from "@blksails/pi-web-kit";
import { cn } from "../lib/cn.js";
import { useCaretAnchor } from "../completion/use-caret-anchor.js";
import {
  parseCommandStage,
  type CommandArgItem,
  type CommandArgProvider,
  type SubcommandSpec,
} from "./command-arg.js";

/** 扩展贡献的 slash 候选(经 ui-rpc 回 agent 取),与内核命令并列展示。 */
export interface ExtensionSlashItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

/** 扩展 slash 贡献点(`WebExtension.contributions.slash`)。 */
export interface ExtensionSlashContribution {
  list(
    query: string,
    rpc: UiRpcClient,
  ): Promise<readonly ExtensionSlashItem[]>;
  execute?(id: string, rpc: UiRpcClient): Promise<void>;
}

/**
 * 扩展(source==="extension")命令在补全中的可见策略。
 *
 * 未提供时等价 { enabled: false, allowlist: [] }:隐藏所有扩展命令(web 端会卡 pending,
 * 见文件头说明)。
 */
export interface ExtensionCommandPolicy {
  /** 放行所有扩展命令(谨慎:多数扩展命令在 web 端会卡死)。默认 false。 */
  readonly enabled?: boolean;
  /** 按命令名放行的扩展命令白名单(即使 enabled=false 也显示)。默认空。 */
  readonly allowlist?: readonly string[];
}

export interface PiCommandPaletteProps {
  readonly controls: UsePiControlsResult;
  /** 当前输入值;以 "/" 开头时激活命令模式。 */
  readonly value: string;
  /** 把选中命令填充回输入区。 */
  readonly onChange: (next: string) => void;
  /** 可选:回车确认时提交(默认仅填充)。 */
  readonly onSubmit?: (command: RpcSlashCommand) => void;
  /** 可选:命令浮层是否正在捕获按键(open && filtered.length > 0)。 */
  readonly onCaptureChange?: (capturing: boolean) => void;
  /** 扩展命令可见策略(全局开关 + 白名单);默认隐藏所有扩展命令。 */
  readonly extensionCommands?: ExtensionCommandPolicy;
  /** 扩展 slash 贡献点(经 ui-rpc 取候选);与内核命令并列展示(R10)。 */
  readonly slashContribution?: ExtensionSlashContribution;
  /** ui-rpc 客户端(扩展贡献回 agent 的通道);缺省则不取扩展候选。 */
  readonly uiRpc?: UiRpcClient;
  /**
   * harness 内置命令(source==="builtin",builtin-plugin-command):前置合流到 agent 命令前、
   * 同名内置优先。选中时不填输入框/不发提示,改走 {@link onBuiltinSelect} 分派。
   */
  readonly builtinCommands?: readonly RpcSlashCommand[];
  /** 选中内置命令时的分派回调(rawValue 为当前输入,供解析子命令/参数)。 */
  readonly onBuiltinSelect?: (command: RpcSlashCommand, rawValue: string) => void;
  /**
   * 底层 textarea ref:用于把命令面板锚定到 `/` 光标(与 `@` 补全一致)。缺省时退化为
   * 不锚定(由调用方自行定位)。
   */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * 命令参数补全注册表(plugin-subcommand-completion):为声明了 argSpec 的命令(如 /plugin)
   * 做子命令/参数分阶段补全。缺省 → 仅命令名补全(既有行为)。
   */
  readonly commandArgProvider?: CommandArgProvider;
  readonly className?: string;
}

function isCommandMode(value: string): boolean {
  return value.startsWith("/");
}

function queryOf(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

/** 按策略判定某命令是否应在补全中可见(非扩展命令始终可见)。 */
function isCommandVisible(
  c: RpcSlashCommand,
  policy: ExtensionCommandPolicy | undefined,
): boolean {
  if (c.source !== "extension") return true; // 非扩展命令不受策略影响
  if (policy?.enabled === true) return true; // 全局放行
  return policy?.allowlist?.includes(c.name) ?? false; // 白名单放行,否则隐藏
}

export function PiCommandPalette({
  controls,
  value,
  onChange,
  onSubmit,
  onCaptureChange,
  extensionCommands,
  slashContribution,
  uiRpc,
  builtinCommands,
  onBuiltinSelect,
  inputRef,
  commandArgProvider,
  className,
}: PiCommandPaletteProps): React.JSX.Element | null {
  const open = isCommandMode(value);
  const [commands, setCommands] = React.useState<readonly RpcSlashCommand[]>(
    controls.commands ?? [],
  );
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [active, setActive] = React.useState<number>(0);
  const listId = React.useId();

  // 进入命令模式时拉取命令(若 hook 未已暴露)。
  // 依赖只取稳定成员 controls.getCommands / controls.commands:usePiControls 返回的
  // controls 对象每次渲染都是新引用(且 state 在 setOp 时真实变化),若依赖整个 controls,
  // effect 会每渲染都触发→getCommands()→setOp→重渲染→…无限循环(React #185)。
  const { commands: controlsCommands, getCommands } = controls;
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (controlsCommands !== undefined) {
      setCommands(controlsCommands);
      setError(undefined);
      return;
    }
    void getCommands()
      .then((res) => {
        if (cancelled) return;
        setCommands(res.commands);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, controlsCommands, getCommands]);

  // 合流内置命令:同名以内置优先;追加在 agent 命令后(不改既有默认选中)(builtin-plugin-command)。
  const mergedCommands = React.useMemo(() => {
    if (builtinCommands === undefined || builtinCommands.length === 0) {
      return commands;
    }
    const names = new Set(builtinCommands.map((c) => c.name));
    return [...commands.filter((c) => !names.has(c.name)), ...builtinCommands];
  }, [builtinCommands, commands]);

  const query = queryOf(value).toLowerCase();
  const filtered = React.useMemo(
    () =>
      mergedCommands.filter(
        // extension 命令默认隐藏(web 端会卡死,永不发 agent_end);可经策略放行。
        (c) =>
          isCommandVisible(c, extensionCommands) &&
          c.name.toLowerCase().includes(query),
      ),
    [mergedCommands, query, extensionCommands],
  );

  // R10:扩展 slash 贡献候选(经 ui-rpc 异步取,与内核命令并列)。
  const [extItems, setExtItems] = React.useState<readonly ExtensionSlashItem[]>(
    [],
  );
  React.useEffect(() => {
    if (!open || slashContribution === undefined || uiRpc === undefined) {
      setExtItems([]);
      return;
    }
    let cancelled = false;
    void slashContribution
      .list(queryOf(value), uiRpc)
      .then((items) => {
        if (!cancelled) setExtItems(items);
      })
      .catch(() => {
        if (!cancelled) setExtItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, value, slashContribution, uiRpc]);

  const selectExt = React.useCallback(
    (item: ExtensionSlashItem): void => {
      if (slashContribution?.execute !== undefined && uiRpc !== undefined) {
        void slashContribution.execute(item.id, uiRpc).catch(() => undefined);
      }
      onChange("");
    },
    [slashContribution, uiRpc, onChange],
  );

  // ── plugin-subcommand-completion:子命令/参数分阶段补全 ──
  // 命令名(命令模式下首段),据此查 argSpec;无 spec → stage 恒为 command(退回既有补全)。
  const cmdName = value.startsWith("/")
    ? (value.slice(1).split(/\s+/)[0] ?? "")
    : "";
  const spec = commandArgProvider?.specFor(cmdName);
  const stage = React.useMemo(
    () => parseCommandStage(value, spec),
    [value, spec],
  );
  const inArgFlow = spec !== undefined && stage.kind !== "command";

  // 参数阶段:异步取候选(防抖 + cancel),与扩展 slash 取数同范式。
  const [argItems, setArgItems] = React.useState<readonly CommandArgItem[]>([]);
  React.useEffect(() => {
    if (
      !open ||
      stage.kind !== "arg" ||
      commandArgProvider === undefined
    ) {
      setArgItems([]);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void commandArgProvider
        .listArgs(stage.command, stage.sub.name, stage.query, ctrl.signal)
        .then((items) => {
          if (!cancelled) setArgItems(items);
        })
        .catch(() => {
          if (!cancelled) setArgItems([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, stage, commandArgProvider]);

  // 子命令候选:按 query 前缀过滤;已就位的终态子命令(尾空格)从候选移除以让 Enter 执行。
  const subEntries = React.useMemo<readonly SubcommandSpec[]>(() => {
    if (!inArgFlow || stage.kind !== "subcommand" || spec === undefined) {
      return [];
    }
    const q = stage.query.toLowerCase();
    const endsWithSpace = /\s$/.test(value);
    return spec.subcommands.filter((s) => {
      const names = [s.name, ...(s.aliases ?? [])].map((n) => n.toLowerCase());
      const hit = q.length === 0 || names.some((n) => n.startsWith(q));
      if (!hit) return false;
      // 终态子命令且已 `/cmd sub ` 就位 → 不再展示(关闭浮层,Enter 执行)。
      if (s.terminal && endsWithSpace && names.includes(q)) return false;
      return true;
    });
  }, [inArgFlow, stage, spec, value]);

  /** arg-flow 的统一线性候选(子命令或参数),驱动键盘导航与渲染。 */
  interface NavEntry {
    readonly key: string;
    readonly label: string;
    readonly detail?: string;
    readonly select: () => void;
  }

  const selectSub = React.useCallback(
    (s: SubcommandSpec): void => {
      // 非终态/终态都先填 `/cmd sub `;非终态进入参数阶段,终态就位待 Enter 执行。
      onChange(`/${cmdName} ${s.name} `);
    },
    [onChange, cmdName],
  );

  const selectArg = React.useCallback(
    (item: CommandArgItem): void => {
      if (stage.kind !== "arg") return;
      const next = value.slice(0, stage.start) + item.insertText + " ";
      onChange(next);
      const el = inputRef?.current ?? null;
      if (el !== null) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(next.length, next.length);
        });
      }
    },
    [stage, value, onChange, inputRef],
  );

  const argNav = React.useMemo<readonly NavEntry[]>(() => {
    if (!inArgFlow) return [];
    if (stage.kind === "subcommand") {
      return subEntries.map((s) => ({
        key: s.name,
        label: `/${cmdName} ${s.name}`,
        ...(s.terminal ? {} : { detail: `<${s.argKind ?? "arg"}>` }),
        select: () => selectSub(s),
      }));
    }
    return argItems.map((it) => ({
      key: it.id,
      label: it.label,
      ...(it.detail !== undefined ? { detail: it.detail } : {}),
      select: () => selectArg(it),
    }));
  }, [inArgFlow, stage, subEntries, argItems, cmdName, selectSub, selectArg]);

  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  // 上报捕获状态:open && 有候选 → true;否则 false。
  // 放在早返回 `if (!open) return null` 之前以遵守 hooks 规则。
  const onCaptureChangeRef = React.useRef(onCaptureChange);
  onCaptureChangeRef.current = onCaptureChange;
  const capturing =
    open &&
    (inArgFlow
      ? argNav.length > 0
      : filtered.length > 0 || extItems.length > 0);
  const prevCapturingRef = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    if (prevCapturingRef.current !== capturing) {
      prevCapturingRef.current = capturing;
      onCaptureChangeRef.current?.(capturing);
    }
  }, [capturing]);

  const select = React.useCallback(
    (cmd: RpcSlashCommand): void => {
      // 内置命令:执行 harness 逻辑,不填输入框、不发提示(builtin-plugin-command)。
      if (cmd.source === "builtin") {
        onBuiltinSelect?.(cmd, value);
        onChange("");
        return;
      }
      // 有 argSpec 的命令(如 /plugin):只填 `/cmd ` 进入子命令阶段,不提交执行。
      if (commandArgProvider?.specFor(cmd.name) !== undefined) {
        onChange(`/${cmd.name} `);
        return;
      }
      onChange(`/${cmd.name} `);
      if (onSubmit !== undefined) onSubmit(cmd);
    },
    [onChange, onSubmit, onBuiltinSelect, value, commandArgProvider],
  );

  const handleKey = React.useCallback(
    (e: Pick<KeyboardEvent, "key" | "preventDefault">): boolean => {
      // arg-flow(子命令/参数阶段)优先:导航 argNav。
      if (inArgFlow) {
        if (argNav.length === 0) {
          if (e.key === "Escape") {
            e.preventDefault();
            onChange("");
            return true;
          }
          return false; // 无候选时不拦 Enter(让其按既有逻辑发送/换行)。
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => (i + 1) % argNav.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => (i - 1 + argNav.length) % argNav.length);
          return true;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          argNav[active % argNav.length]?.select();
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onChange("");
          return true;
        }
        return false;
      }

      if (filtered.length === 0) {
        if (e.key === "Escape") {
          onChange("");
          return true;
        }
        return false;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % filtered.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % filtered.length);
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd !== undefined) select(cmd);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
        return true;
      }
      return false;
    },
    [inArgFlow, argNav, filtered, active, onChange, select],
  );

  // 命令模式下,即便焦点在外部输入框(prompt input),也捕获方向键/回车/Esc 导航。
  React.useEffect(() => {
    if (!open) return;
    const listener = (e: KeyboardEvent): void => {
      handleKey(e);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [open, handleKey]);

  // 锚定到 `/` 光标(行首,offset 0),与 `@` 补全一致(completion-cursor-anchor)。
  // inputRef 缺省时退化为不锚定(positionStyle 仍返回 fixed 左上安全位,由调用方包裹定位)。
  const positionStyle = useCaretAnchor({
    inputRef,
    offset: 0,
    active: open && inputRef !== undefined,
    recomputeOn: value,
  });

  if (!open) return null;

  // arg-flow:无候选(含已就位终态子命令)→ 关闭浮层,让 Enter 执行/换行。
  if (inArgFlow && argNav.length === 0) return null;

  const activeId = `${listId}-opt-${active}`;

  // ── arg-flow 渲染:子命令/参数候选(复用浮层外壳与 caret 锚定)──
  if (inArgFlow) {
    const idx = active % argNav.length;
    return (
      <div
        className={cn(
          "z-50 min-w-[16rem] max-w-[24rem] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
          className,
        )}
        style={positionStyle ?? undefined}
        data-pi-command-palette
        data-pi-command-stage={stage.kind}
      >
        <ul
          role="listbox"
          id={listId}
          aria-label="Command arguments"
          aria-activedescendant={`${listId}-opt-${idx}`}
          tabIndex={-1}
          className="max-h-64 overflow-y-auto p-1"
        >
          {argNav.map((entry, i) => (
            <li
              key={entry.key}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === idx}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => entry.select()}
              className={cn(
                "flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm",
                i === idx
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                  : "",
              )}
              data-pi-command-item={entry.key}
            >
              <span className="font-medium">{entry.label}</span>
              {entry.detail !== undefined ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {entry.detail}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "z-50 min-w-[16rem] max-w-[24rem] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      style={positionStyle ?? undefined}
      data-pi-command-palette
    >
      {error !== undefined ? (
        <div
          role="alert"
          className="p-3 text-sm text-[hsl(var(--destructive))]"
          data-pi-command-error
        >
          {error}
        </div>
      ) : filtered.length === 0 && extItems.length === 0 ? (
        <div
          className="p-3 text-sm text-[hsl(var(--muted-foreground))]"
          data-pi-command-empty
        >
          No commands
        </div>
      ) : (
        <ul
          role="listbox"
          id={listId}
          aria-label="Slash commands"
          aria-activedescendant={activeId}
          tabIndex={-1}
          className="max-h-64 overflow-y-auto p-1"
        >
          {extItems.map((item) => (
            <li
              key={`ext-${item.id}`}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectExt(item)}
              className="flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
              data-pi-command-item={item.id}
              data-pi-command-source="extension"
            >
              <span className="font-medium">{item.title}</span>
              {item.description !== undefined ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {item.description}
                </span>
              ) : null}
            </li>
          ))}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.name}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(cmd)}
              className={cn(
                "flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm",
                i === active
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                  : "",
              )}
              data-pi-command-item={cmd.name}
              data-pi-command-source={cmd.source}
            >
              <span className="flex items-center gap-1.5 font-medium">
                /{cmd.name}
                {cmd.source === "builtin" ? (
                  <span
                    data-pi-command-builtin-badge
                    className="rounded-sm bg-[hsl(var(--muted))] px-1 py-0.5 text-[10px] font-normal text-[hsl(var(--muted-foreground))]"
                  >
                    内置
                  </span>
                ) : null}
              </span>
              {cmd.description !== undefined ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {cmd.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

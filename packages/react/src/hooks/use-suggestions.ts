/**
 * useSuggestions — 合并 pi 命令与可配置预设为建议项(Req 10.1, 10.3)。
 *
 * - items = pi commands(映射 RpcSlashCommand → Suggestion)∪ presets。
 *   命令默认 mode "fill"(斜杠命令填入输入框);presets 由调用方给定其 mode。
 * - 复用 usePiControls 的 `commands` 状态与 `getCommands()` 拉取(经 options.controls 传入)。
 * - 无命令且无预设时 items 为 [](Req 10.3,UI 据此不渲染建议区域)。
 * - pending 反映 controls.getCommands 操作态(若提供 controls)。
 */
import { useMemo } from "react";
import type { RpcSlashCommand } from "@pi-web/protocol";
import type { UsePiControlsResult } from "./use-pi-controls.js";

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly mode: "fill" | "send";
}

export interface UseSuggestionsOptions {
  /** 复用 usePiControls 的 getCommands/commands。 */
  readonly controls?: UsePiControlsResult;
  /** 可配置预设建议项;各项 mode 由调用方给定。 */
  readonly presets?: ReadonlyArray<Suggestion>;
}

export interface UseSuggestionsResult {
  /** commands ∪ presets;空源则 []。 */
  readonly items: ReadonlyArray<Suggestion>;
  readonly pending: boolean;
}

function commandToSuggestion(cmd: RpcSlashCommand): Suggestion {
  const slash = `/${cmd.name}`;
  return { id: `cmd:${cmd.name}`, label: slash, value: slash, mode: "fill" };
}

export function useSuggestions(
  opts: UseSuggestionsOptions,
): UseSuggestionsResult {
  const commands = opts.controls?.commands;
  const presets = opts.presets;

  const items = useMemo<ReadonlyArray<Suggestion>>(() => {
    const fromCommands = (commands ?? []).map(commandToSuggestion);
    const fromPresets = presets ?? [];
    return [...fromCommands, ...fromPresets];
  }, [commands, presets]);

  const pending = opts.controls?.state.getCommands.pending ?? false;

  return { items, pending };
}

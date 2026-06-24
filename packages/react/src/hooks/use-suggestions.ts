/**
 * useSuggestions — 合并 pi 命令与可配置预设为建议项(Req 10.1, 10.3)。
 *
 * - items = pi commands(映射 RpcSlashCommand → Suggestion)与 presets 按 merge 策略合并。
 *   命令默认 mode "fill"(斜杠命令填入输入框);presets 由调用方给定其 mode。
 * - merge 策略:
 *   - "append"(默认):命令在前、presets 在后(与历史行为一致)。
 *   - "prepend":presets 在前、命令在后。
 *   - "replace":仅 presets;presets 为空时回落命令,避免空态无任何建议。
 * - 复用 usePiControls 的 `commands` 状态与 `getCommands()` 拉取(经 options.controls 传入)。
 * - 无命令且无预设时 items 为 [](Req 10.3,UI 据此不渲染建议区域)。
 * - pending 反映 controls.getCommands 操作态(若提供 controls)。
 */
import { useMemo } from "react";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";
import type { UsePiControlsResult } from "./use-pi-controls.js";

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly mode: "fill" | "send";
}

/** 命令与预设的合并策略。 */
export type SuggestionMerge = "append" | "prepend" | "replace";

export interface UseSuggestionsOptions {
  /** 复用 usePiControls 的 getCommands/commands。 */
  readonly controls?: UsePiControlsResult;
  /** 可配置预设建议项;各项 mode 由调用方给定。 */
  readonly presets?: ReadonlyArray<Suggestion>;
  /** presets 与命令的合并策略;默认 "append"(命令在前)。 */
  readonly merge?: SuggestionMerge;
}

export interface UseSuggestionsResult {
  /** commands 与 presets 按 merge 合并;空源则 []。 */
  readonly items: ReadonlyArray<Suggestion>;
  readonly pending: boolean;
}

function commandToSuggestion(cmd: RpcSlashCommand): Suggestion {
  const slash = `/${cmd.name}`;
  return { id: `cmd:${cmd.name}`, label: slash, value: slash, mode: "fill" };
}

function mergeSuggestions(
  fromCommands: ReadonlyArray<Suggestion>,
  fromPresets: ReadonlyArray<Suggestion>,
  merge: SuggestionMerge,
): ReadonlyArray<Suggestion> {
  switch (merge) {
    case "prepend":
      return [...fromPresets, ...fromCommands];
    case "replace":
      // 仅展示配置项;配置为空时回落命令,避免空态无任何建议(Req 4.4)。
      return fromPresets.length > 0 ? fromPresets : fromCommands;
    case "append":
    default:
      return [...fromCommands, ...fromPresets];
  }
}

export function useSuggestions(
  opts: UseSuggestionsOptions,
): UseSuggestionsResult {
  const commands = opts.controls?.commands;
  const presets = opts.presets;
  const merge = opts.merge ?? "append";

  const items = useMemo<ReadonlyArray<Suggestion>>(() => {
    const fromCommands = (commands ?? []).map(commandToSuggestion);
    const fromPresets = presets ?? [];
    return mergeSuggestions(fromCommands, fromPresets, merge);
  }, [commands, presets, merge]);

  const pending = opts.controls?.state.getCommands.pending ?? false;

  return { items, pending };
}

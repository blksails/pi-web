/**
 * slash-completions-wiring — runner 装配期把 agent 声明的静态 slash 补全候选推给
 * server 主进程(spec agent-slash-completion)。
 *
 * 调用点在 `runner.ts` 的装配序列尾、`runRpcMode(runtime)` **之前**——此窗口 stdout
 * 仍由 pi-web 自有子进程代码掌控(`runRpcMode` 之后归 pi SDK)。发一条 pi-web 自建的
 * `slash_completions` JSONL 帧;主进程 `PiSession.handleRawLine` 识别并按会话缓存。
 *
 * 不触及外部 pi SDK;无声明则不发帧(下游会话行为不变)。
 */
import type { SlashCompletionsFrame } from "@blksails/pi-web-protocol";
import type { NormalizedAgentRuntimeFactory } from "./agent-loader.js";

/**
 * 若 factory 携带非空 `slashCompletions`,向 stdout 写一条 `slash_completions` 帧。
 *
 * @param factory runner 归一化后的 runtime factory(带 pi-web 元数据)。
 * @param write   行写出函数(默认 `process.stdout.write`);注入以便单测。
 */
export function emitSlashCompletions(
  factory: Pick<NormalizedAgentRuntimeFactory, "slashCompletions">,
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
): void {
  const items = factory.slashCompletions;
  if (items === undefined || items.length === 0) return;
  const frame: SlashCompletionsFrame = {
    type: "slash_completions",
    items: [...items],
  };
  write(JSON.stringify(frame) + "\n");
}

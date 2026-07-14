/**
 * attachment-profile-wiring — runner 装配期把 agent 声明的附件写目标 profile 推给
 * server 主进程(spec agent-attachment-profile,任务 3.2;Req 2.3, 5.1)。
 *
 * `slash_completions`/`agent_routes` 同族:调用点在 `runner.ts` 装配序列尾、
 * `runRpcMode(runtime)` **之前**(此窗口 stdout 仍由 pi-web 自有子进程代码掌控)。发一条
 * pi-web 自建的 `agent_attachment_profile` JSONL 帧;主进程 `PiSession.handleRawLine`
 * 识别并按会话缓存(防御性核对,子进程装配期校验才是权威,见 `runner.ts`)。
 *
 * 关断(`PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED === "1"`)优先于一切:视同未声明,
 * 零帧(与白名单校验的关断分支一致,`runner.ts` 消费同一常量)。
 */
import type { AgentAttachmentProfileFrame } from "@blksails/pi-web-protocol";
import type { NormalizedAgentRuntimeFactory } from "./agent-loader.js";
import {
  ATTACHMENT_PROFILE_DISABLED_ENV,
  isAttachmentProfileDisabled,
} from "../attachment/backends-config.js";

/**
 * 运维关断 env(`"1"` 关断;默认开启,与 `PI_WEB_AGENT_ROUTES_DISABLED` 同风格,Req 5.1/5.2)。
 * 关断时:子进程不校验白名单、不静态覆盖写路由、不发本帧;主进程消费侧也丢弃该帧(双保险)。
 *
 * 权威定义 + 判定函数在 `../attachment/backends-config.js`(须同时被主/子进程两侧触达,
 * 该模块经 `@blksails/pi-web-server` 主入口导出,`runner/` 不导出);此处重导出供
 * runner 内部模块沿用既有导入路径。
 */
export { ATTACHMENT_PROFILE_DISABLED_ENV, isAttachmentProfileDisabled };

/**
 * 若 `disabled` 未生效且 factory 携带 `attachmentProfile`,向 stdout 写一条
 * `agent_attachment_profile` 帧。
 *
 * @param factory runner 归一化后的 runtime factory(带 pi-web 元数据)。
 * @param disabled 关断门控是否生效(由调用方按 {@link isAttachmentProfileDisabled} 判定一次,
 *   与白名单校验共享同一次判定结果,避免装配期内 env 读取不一致)。
 * @param write   行写出函数(默认 `process.stdout.write`);注入以便单测。
 */
export function emitAttachmentProfile(
  factory: Pick<NormalizedAgentRuntimeFactory, "attachmentProfile">,
  disabled: boolean,
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
): void {
  if (disabled) return;
  const profile = factory.attachmentProfile;
  if (profile === undefined) return;
  const frame: AgentAttachmentProfileFrame = {
    type: "agent_attachment_profile",
    profile,
  };
  write(JSON.stringify(frame) + "\n");
}

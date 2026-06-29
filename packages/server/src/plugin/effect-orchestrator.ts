/**
 * 装完即时双路生效编排器(spec: plugin-system-unification,Req 7)。
 *
 * 安装完成后按 PluginDescriptor 并行触发两路、互不阻塞:
 *  - 路①(pi 资源):reloadRuntime 重启 runner 使工具/命令生效;
 *  - 路②(webext):signalWebextReload 驱动前端重解析加载(setWebextReloadNonce)。
 *
 * 纯编排 + 注入式依赖:仅 pi / 仅 webext / 双层三种 descriptor 走不同分支;
 * 任一路抛错被各自捕获为 {error},不阻断另一路、不抛出(Req 7.2/7.3/7.4)。
 */
import type { PluginDescriptor } from "./plugin.types.js";

/** 路①:重载运行时使 pi 资源生效(底层 SessionReloader / restartRunner)。 */
export type ReloadRuntimeFn = (sessionId: string) => Promise<void>;
/** 路②:触发前端 webext 重解析加载(驱动 reloadNonce)。可同步或异步。 */
export type SignalWebextReloadFn = (sessionId: string) => Promise<void> | void;

export interface EffectOrchestratorDeps {
  readonly reloadRuntime: ReloadRuntimeFn;
  readonly signalWebextReload: SignalWebextReloadFn;
}

export interface OnInstallCompleteInput {
  readonly sessionId: string;
  readonly source: string;
  readonly descriptor: PluginDescriptor;
}

export type PathOutcome<TOk extends string> =
  | TOk
  | "skipped"
  | { readonly error: string };

export interface EffectResult {
  readonly reload: PathOutcome<"ok">;
  readonly webext: PathOutcome<"signaled">;
}

function descriptorHasPiResources(d: PluginDescriptor): boolean {
  return (
    d.pi.extensions.length > 0 ||
    d.pi.skills.length > 0 ||
    d.pi.prompts.length > 0 ||
    d.pi.themes.length > 0
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 安装完成后运行双路生效。两路 Promise.all 并行;每路独立 try/catch,
 * 任一失败不影响另一路(Req 7.2)。仅含一层的包另一路 "skipped"(Req 7.3/7.4)。
 */
export async function runInstallEffects(
  input: OnInstallCompleteInput,
  deps: EffectOrchestratorDeps,
): Promise<EffectResult> {
  const hasPi = descriptorHasPiResources(input.descriptor);
  const hasWeb = input.descriptor.web !== undefined;

  // 调用延入 promise 链:同步 throw 与异步 reject 都被各自的 .catch 捕获(Req 7.2)。
  const reloadTask: Promise<PathOutcome<"ok">> = hasPi
    ? Promise.resolve()
        .then(() => deps.reloadRuntime(input.sessionId))
        .then((): PathOutcome<"ok"> => "ok")
        .catch((e: unknown): PathOutcome<"ok"> => ({ error: errorMessage(e) }))
    : Promise.resolve<PathOutcome<"ok">>("skipped");

  const webextTask: Promise<PathOutcome<"signaled">> = hasWeb
    ? Promise.resolve()
        .then(() => deps.signalWebextReload(input.sessionId))
        .then((): PathOutcome<"signaled"> => "signaled")
        .catch((e: unknown): PathOutcome<"signaled"> => ({ error: errorMessage(e) }))
    : Promise.resolve<PathOutcome<"signaled">>("skipped");

  const [reload, webext] = await Promise.all([reloadTask, webextTask]);
  return { reload, webext };
}

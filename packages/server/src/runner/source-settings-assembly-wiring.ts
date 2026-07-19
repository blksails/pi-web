/**
 * 装配期 per-source settings 注入(spec: source-settings-and-slots,任务 3.1;
 * design.md「装配期注入(IPC,双通道)」通道 a;Requirements 4.1-4.5)。
 *
 * runner 装配期(`runner.ts` 构造 {@link AgentContext} 处)调用本模块,把该 source 已保存
 * 的 per-source settings 值解析进 `ctx.settings`。与 `option-mapper.ts` 读 auth.json 的
 * 装配期读盘先例同法:纯 best-effort 读取,任何失败(未声明 settings、清单缺失/非法、
 * 文件不存在、scope 门控未过)一律降级为空对象 `{}`,绝不使装配失败(Req 4.5)。
 *
 * `sourceKey` 输入:复用 `resolvePiPlugin` 的 `PluginDescriptor.id`(清单 id → package.json
 * name → 目录名,同一 source 升版不变,拍板 Q2)——与 HTTP 端点(任务 2.2)、持久化(任务 2.1)
 * 共享同一稳定标识,三者对同一 source 解析出同一 sourceKey。
 *
 * scope 门控(Req 2.2 / design 装配期注入段):`scope:"project"` 落盘于 `<cwd>/.pi/
 * source-settings/`,与既有 `<cwd>/.pi/` 项目级资源(extensions/agents/skills)同规——
 * 只在项目受信任(`trusted`,runner.ts 已算好的信任判定)时读取;未受信任时视同未声明
 * settings,注入空对象,不读盘、不触碰未信任项目的文件系统内容。
 */
import { dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { resolvePiPlugin } from "../plugin/resolve-plugin.js";
import { sourceKey as deriveSourceKey } from "../source-key.js";
import { SourceSettingsCodec } from "../config/source-settings-codec.js";

/** 装配期注入所需的最小输入面。 */
export interface AssemblySourceSettingsParams {
  /** `--agent` 原样值:可以是包根目录,也可以是包内的入口文件(agent-loader 两者皆收)。 */
  readonly agentPath: string;
  /** 会话工作目录(`scope:"project"` 的分区键)。 */
  readonly cwd: string;
  /** 全局 agent 配置目录(`scope:"source"` 的落盘根;未提供时 codec 回退默认位置)。 */
  readonly agentDir: string | undefined;
  /** 项目信任判定(runner.ts 已算好的 `args.trusted || PI_WEB_TRUST_PROJECT===1`)。 */
  readonly trusted: boolean;
}

/**
 * `agentPath` 可能是包根目录(如 `examples/state-bridge-agent`,jiti 自行解析
 * `index.ts`),也可能是具体入口文件(如包根下的 `index.ts`,或 `package.json#pi-web.entry`
 * 指向的嵌套路径)。`resolvePiPlugin` 需要包根:是目录则直接用,是文件则取其父目录 ——
 * 覆盖 `entry-probe.ts` 的两种优先级产物(默认 `index.*` 与覆盖入口,均以包根为父目录)
 * 及测试直传目录两种既有调用形态。嵌套覆盖入口(父目录非包根)在此降级为「探测不到清单」
 * ——与其他未声明/非法情形归一,注入空对象,不视为错误(Req 4.5 的「零变化」精神)。
 */
function resolvePackageDir(agentPath: string): string {
  try {
    if (existsSync(agentPath) && statSync(agentPath).isDirectory()) {
      return agentPath;
    }
  } catch {
    // 探测失败(权限/竞态等)→ 按文件路径回退,不阻断装配。
  }
  return dirname(agentPath);
}

/**
 * 解析装配期注入的 `ctx.settings` 值。Best-effort:任何环节失败都归一为 `{}`。
 */
export async function resolveAssemblySourceSettings(
  params: AssemblySourceSettingsParams,
): Promise<Readonly<Record<string, unknown>>> {
  const packageDir = resolvePackageDir(params.agentPath);

  let descriptor: Awaited<ReturnType<typeof resolvePiPlugin>>;
  try {
    descriptor = await resolvePiPlugin(packageDir);
  } catch {
    // resolvePiPlugin 本身设计为不抛错(降级 diagnostics);此处仅作双重保险。
    return {};
  }

  const settings = descriptor.settings;
  if (settings === undefined) return {}; // 未声明/降级(Req 1.3, 4.5):零变化。

  if (settings.scope === "project" && !params.trusted) {
    // 未信任项目:与「不加载项目级 .pi/ 资源」同语义,不读该项目的 per-source 设置文件。
    return {};
  }

  const key = deriveSourceKey(descriptor.id);
  const codec = new SourceSettingsCodec(params.agentDir);
  try {
    return await codec.load(
      settings.scope,
      key,
      settings.scope === "project" ? params.cwd : undefined,
    );
  } catch {
    // 读盘失败(权限/损坏 JSON 等已由 codec 内部容错;此处兜底任何意外抛出)→ 空对象。
    return {};
  }
}

/**
 * resource-options — `AgentDefinition` 的**资源类**字段 → pi SDK `resourceLoaderOptions`,
 * 以及强制注入扩展入口的收集。
 *
 * 自 `option-mapper.ts` 原样析出(SRP:资源映射 / 会话映射 / factory 装配三件事分开)。
 * 行为逐字保持;`option-mapper.ts` 继续 re-export 本模块的公开符号,既有 import 零改动。
 *
 * 边界:本模块只回答「**哪些资源随会话载入**」——系统提示、扩展、skills、prompts、
 * context 文件。模型与工具属会话类,见 `session-options.ts`。
 */
import { basename, extname } from "node:path";
import type { AgentDefinition } from "@blksails/pi-web-core/agent-definition.js";
import type {
  CreateAgentSessionServicesOptions,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { resolveBuiltinExtensionEntries } from "./builtin-extensions.js";

type ResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions["resourceLoaderOptions"]
>;

/** The SDK `LoadExtensionsResult` — the `base` type passed to `extensionsOverride`. */
type LoadExtensionsResult = Parameters<
  NonNullable<ResourceLoaderOptions["extensionsOverride"]>
>[0];
/** A single loaded extension as carried by `LoadExtensionsResult.extensions`. */
type LoadedExtension = LoadExtensionsResult["extensions"][number];

/**
 * Derive an extension's name from its `path`: the basename without extension.
 * Compared against `allowExtensions` entries. Kept as a small in-file helper to
 * ease unit testing and calibration against real extension samples.
 */
function extensionName(ext: LoadedExtension): string {
  return basename(ext.path, extname(ext.path));
}

/**
 * Result of mapping the resource-class fields of an {@link AgentDefinition}.
 * Exposed for unit testing the mapping in isolation.
 */
export interface MappedResourceLoaderOptions {
  resourceLoaderOptions: ResourceLoaderOptions;
}

/** Explicit company resource paths forwarded by the host. */
export interface CompanyResourcePaths {
  readonly additionalSkillPaths?: readonly string[];
  readonly additionalPromptTemplatePaths?: readonly string[];
}

/**
 * pi-web「扩展 → 系统资源」面板开关,由 runner `--no-skills`/`--no-extensions` 透传至此。
 * `true` = 关闭(不载入);`undefined` = 默认载入。二者相互独立。
 */
export interface SystemResourceOverrides {
  readonly noSkills?: boolean;
  readonly noExtensions?: boolean;
}

/**
 * Map the resource-class fields of a definition to `resourceLoaderOptions`,
 * binding the trust hook via `resourceLoaderReloadOptions` is handled by the
 * caller (the factory). Absent fields are omitted entirely.
 */
export function mapResourceLoaderOptions(
  def: AgentDefinition,
  opts: {
    forcedExtensionPaths?: readonly string[];
    /** 系统资源开关 `--no-skills`:`true` → 清空 skills 覆盖(优先于 `def.skills`)。 */
    noSkills?: boolean;
    /** 系统资源开关 `--no-extensions`:`true` → `noExtensions=true`(强制注入路径仍载入)。 */
    noExtensions?: boolean;
    /** 公司级 resources,不改变 pi 的 user/project 默认发现。 */
    companyResourcePaths?: CompanyResourcePaths;
  } = {},
): MappedResourceLoaderOptions {
  const resourceLoaderOptions: ResourceLoaderOptions = {};
  // 强制注入路径(如 pi-sandbox):不论 agent 的 extensions/allowExtensions 如何,
  // 始终随会话加载。SDK 在 noExtensions 下仍加载 additionalExtensionPaths;whitelist
  // (extensionsOverride)分支须额外放行其 basename(见下)。
  const forced = (opts.forcedExtensionPaths ?? []).filter((p) => p.length > 0);
  const forcedBasenames = new Set(forced.map((p) => basename(p)));

  if (def.systemPrompt !== undefined) {
    const prompt =
      typeof def.systemPrompt === "function" ? def.systemPrompt() : def.systemPrompt;
    // The resource loader applies the override on top of any discovered prompt.
    resourceLoaderOptions.systemPromptOverride = () => prompt;
  }

  const additionalPaths: string[] = [...forced];
  if (def.extensions !== undefined) {
    const factories: ExtensionFactory[] = [];
    for (const item of def.extensions) {
      if (typeof item === "string") {
        additionalPaths.push(item);
      } else {
        factories.push(item);
      }
    }
    if (factories.length > 0) {
      resourceLoaderOptions.extensionFactories = factories;
    }
  }
  if (additionalPaths.length > 0) {
    resourceLoaderOptions.additionalExtensionPaths = additionalPaths;
  }

  // allowExtensions: close-all / whitelist semantics for disk-discovered system
  // extensions. Absent → not injected (SDK default discovery preserved).
  //
  // KNOWN LIMITATION (research.md R-1): a NON-EMPTY allowExtensions still loads
  // every discovered extension first, then filters via `extensionsOverride` — so
  // a closed extension's module code runs once before being dropped. For strong
  // isolation (discovery skipped entirely, no closed-extension code executed),
  // use `allowExtensions: []`, which maps to `noExtensions = true`.
  if (def.allowExtensions !== undefined) {
    const allow = new Set(def.allowExtensions);
    if (allow.size === 0) {
      // Close all: skip discovery; closed-extension code never runs. Explicitly
      // appended items are still preserved by the SDK.
      resourceLoaderOptions.noExtensions = true;
    } else {
      // Whitelist: discover, then keep named extensions + explicitly appended ones.
      const explicitPaths = new Set(
        (def.extensions ?? [])
          .filter((e): e is string => typeof e === "string")
          .map((p) => basename(p)),
      );
      resourceLoaderOptions.extensionsOverride = (base) => ({
        // `...base` preserves `errors` and `runtime` untouched.
        ...base,
        extensions: base.extensions.filter((ext) => {
          if (ext.path.startsWith("<inline:")) return true; // factory-appended item
          if (forcedBasenames.has(basename(ext.path))) return true; // 强制注入(沙箱)豁免白名单
          if (explicitPaths.has(basename(ext.path))) return true; // string-path appended item
          return allow.has(extensionName(ext)); // named whitelist
        }),
      });
    }
  }

  if (def.skills !== undefined) {
    resourceLoaderOptions.skillsOverride = def.skills;
  }
  if (def.promptTemplates !== undefined) {
    resourceLoaderOptions.promptsOverride = def.promptTemplates;
  }
  const companySkills = (opts.companyResourcePaths?.additionalSkillPaths ?? []).filter(
    (p) => p.length > 0,
  );
  if (companySkills.length > 0) resourceLoaderOptions.additionalSkillPaths = companySkills;
  const companyPrompts = (opts.companyResourcePaths?.additionalPromptTemplatePaths ?? []).filter(
    (p) => p.length > 0,
  );
  if (companyPrompts.length > 0) resourceLoaderOptions.additionalPromptTemplatePaths = companyPrompts;
  if (def.contextFiles !== undefined) {
    resourceLoaderOptions.agentsFilesOverride = def.contextFiles;
  }

  // 系统资源开关(pi-web「扩展 → 系统资源」面板,经 runner `--no-skills`/`--no-extensions`)。
  // 置于 def.* 映射之后,使「关闭」无条件优先于 agent 自声明(对齐 pi CLI 行为)。
  if (opts.noSkills === true) {
    // R12-AC2:关闭「系统 skill」(loadSystemSkills=false / --no-skills)时,**仅排除系统/用户/包 skill,
    // 保留项目 scope 的 skill**(`<cwd>/.pi/skills`,origin top-level)——符合开关名义("系统"),避免误杀
    // agent 自带 / 插件随包(被装后 .pi/skills)的技能。项目 skill 的 `sourceInfo.scope === "project"`
    // (loadSkills 已填,见 SDK Skill 类型);用户/包 skill 为 "user",cli 注入为 "temporary",均排除。
    // 优先于 def.skills(Req 1.4):agent 自声明的非项目 skill 同样被关。
    resourceLoaderOptions.skillsOverride = ({ skills, diagnostics }) => ({
      skills: skills.filter((s) => s.sourceInfo?.scope === "project"),
      diagnostics,
    });
  }
  if (opts.noExtensions === true) {
    // 跳过磁盘发现的系统/包 extensions;additionalExtensionPaths(强制注入的沙箱)仍由
    // SDK 加载,沙箱安全门不破(Req 2.3)。白名单 extensionsOverride 在「全关」下无意义,清除。
    resourceLoaderOptions.noExtensions = true;
    delete resourceLoaderOptions.extensionsOverride;
  }

  return { resourceLoaderOptions };
}

/**
 * 从 env 收集强制注入扩展入口路径(custom 模式经 spawn env 下传;空则不注入,行为不变):
 *  - `PI_WEB_SANDBOX_ENTRY`:沙箱 enforcement(不依赖默认发现)。
 *  - `PI_WEB_EXT_TOOLS_ENTRY`:内置「扩展管理扩展」(spec extension-install-agent-tools)。
 *  - `PI_WEB_AUTO_TITLE_ENTRY`:内置「自动会话标题扩展」,由主进程按总开关 PI_WEB_AUTO_TITLE
 *    门控下发(spec auto-session-title)。
 *  - `PI_WEB_MCP_ENTRY`:内置「MCP 客户端扩展」(spec builtin-mcp-client)。
 *
 * ⚠ **自 spec runner-self-resolved-builtins 起,三个 pi-web 自带扩展(ext-tools /
 * auto-title / mcp)的主来源已改为 runner 侧自解析**({@link resolveBuiltinExtensionEntries}),
 * 主进程不再下发其路径。本函数保留仅为**过渡期兼容**:外部编排若仍设置这些 env,识别但不报错
 * (Req 3.3),并由调用方与自解析结果**去重**。
 * `PI_WEB_SANDBOX_ENTRY` 不在自解析范围(入口在 agent 包内,须传 agentDir),仍以 env 为准。
 *
 * 纯函数(env 注入,不读全局),便于单测;顺序固定:sandbox → ext-tools → auto-title → mcp。
 */
export function collectForcedExtensionPaths(env: NodeJS.ProcessEnv): string[] {
  return [
    env["PI_WEB_SANDBOX_ENTRY"],
    env["PI_WEB_EXT_TOOLS_ENTRY"],
    env["PI_WEB_AUTO_TITLE_ENTRY"],
    env["PI_WEB_MCP_ENTRY"],
  ].filter((p): p is string => p !== undefined && p.length > 0);
}

/** Read explicit company roots from spawn env; absent env means no company resources. */
export function collectCompanyResourcePaths(env: NodeJS.ProcessEnv): CompanyResourcePaths {
  const skills = env.PI_WEB_COMPANY_SKILLS_DIR;
  const prompts = env.PI_WEB_COMPANY_PROMPTS_DIR;
  return {
    ...(skills !== undefined && skills.length > 0 ? { additionalSkillPaths: [skills] } : {}),
    ...(prompts !== undefined && prompts.length > 0
      ? { additionalPromptTemplatePaths: [prompts] }
      : {}),
  };
}

/**
 * 本次会话要强制注入的扩展入口 = **自解析的内置扩展** ∪ **env 兼容项**(去重,保序)。
 *
 * 顺序语义:env 项(含 sandbox)在前、自解析项在后 —— 与改造前 `sandbox → ext-tools →
 * auto-title → mcp` 的相对次序一致(改造后 env 通常只剩 sandbox,其余由自解析补齐)。
 *
 * 纯函数(env 与清单均可注入),便于单测。
 */
export function collectExtensionPaths(
  env: NodeJS.ProcessEnv,
  selfResolved: readonly string[] = resolveBuiltinExtensionEntries(),
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...collectForcedExtensionPaths(env), ...selfResolved]) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

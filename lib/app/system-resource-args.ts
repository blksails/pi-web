/**
 * system-resource-args — 据「扩展」面板的两个独立开关,推导建会话时注入 agent 的额外 argv:
 *  - `loadSystemSkills`     关闭 → `--no-skills`(不载入系统/包/内置 skills)
 *  - `loadSystemExtensions` 关闭 → `--no-extensions`(不载入系统/包 extensions)
 *
 * 默认载入(键缺省 / 非 `false`);两开关相互独立。项目 `<cwd>/.pi/settings.json` 覆盖全局
 * `<agentDir>/settings.json`(逐键)。兼容旧版合一键 `loadSystemResources`(显式 false → 二者皆关)。
 * 读失败按"默认载入"处理(不致命)。纯 fs/path,不引 pi SDK,便于单测。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** 读 JSON 对象;不存在 / 解析失败 / 非对象 → undefined(best-effort)。 */
async function readJsonObject(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 逐键解析布尔开关(默认 true):项目优先、全局兜底;再退回旧版合一键 `loadSystemResources`
 * (显式 false → 视该项关闭)。仅显式 `false` 视为关闭。
 */
function pickEnabled(
  key: string,
  project: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined,
): boolean {
  for (const src of [project, global]) {
    if (src === undefined) continue;
    if (key in src) return src[key] !== false;
    if ("loadSystemResources" in src) return src["loadSystemResources"] !== false;
  }
  return true;
}

/**
 * 计算注入 agent 的额外 argv:`loadSystemSkills===false` → `--no-skills`,
 * `loadSystemExtensions===false` → `--no-extensions`(各自独立,可单独/同时出现)。
 * @param agentDir 全局 pi 配置目录(`<agentDir>/settings.json`)。
 * @param cwd      会话工作目录(`<cwd>/.pi/settings.json` 为项目级覆盖)。
 */
export async function systemResourceArgs(
  agentDir: string,
  cwd: string,
): Promise<readonly string[]> {
  const [project, global] = await Promise.all([
    readJsonObject(path.join(cwd, ".pi", "settings.json")),
    readJsonObject(path.join(agentDir, "settings.json")),
  ]);
  const args: string[] = [];
  if (!pickEnabled("loadSystemSkills", project, global)) args.push("--no-skills");
  if (!pickEnabled("loadSystemExtensions", project, global)) {
    args.push("--no-extensions");
  }
  return args;
}
